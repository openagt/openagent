import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { hostInputs, hostModules, type HostFile } from '@openagt/skill-ui/host-modules'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin, type UserConfig } from 'vite'

// Opt-in (`pnpm dev:daemon`, i.e. OPENAGENT_DEV_DAEMON=1): let the dev server actually start runs.
//
// `pnpm dev` alone is the Vite dev server with no daemon behind it, so nothing answers `/_rpc` and
// `sendStart` fails (the same gap that leaves preferences unpersisted in dev).
// Only the daemon has the `startAgent` handler. This plugin brings that daemon up *inside the dev
// server's own process* and proxies `/_rpc` (the calls and the SSE stream) to it, so the
// live-reload UI gets the full backend, run-starting included.
//
// In-process, not spawned: the CLI is foreground-only, so there is no detached daemon to reuse and
// nothing to leave behind — Ctrl-C on the dev server takes the daemon with it. `runDaemon` blocks
// until shutdown, so it is left unawaited and `onListening` reports the port it bound.
//
// The proxy middleware is registered synchronously so it lands ahead of Vite's own handling of the
// path; it holds requests until the daemon is up. Left out by default so the plain dev server stays a
// pure UI harness with no backend behind it.
function openagentDevDaemon(): Plugin {
  return {
    name: 'openagent:dev-daemon',
    apply: 'serve',
    configureServer(server) {
      if (!process.env.OPENAGENT_DEV_DAEMON) return
      let target: { hostname: string; port: string } | null = null
      const ready = (async () => {
        // The one place here that genuinely wants the *build*: this runs in the Vite config's own
        // Node process, outside any transform pipeline, so plain `src/` TypeScript would not load.
        // The specifier is a URL rather than a literal so it stays a runtime import — and the type
        // comes from the source it is built from, so a signature change is still an error here.
        const built = new URL('../dist/daemon.js', import.meta.url).href
        const { runDaemon } = (await import(built)) as typeof import('../src/daemon.js')
        const cwd = process.env.OPENAGENT_DEV_DAEMON_CWD || process.cwd()
        // Ephemeral port: the dev server owns the address the browser talks to, and binding 4200
        // would collide with an `openagent` the developer is running in another terminal.
        const url = await new Promise<string>((resolvePromise, rejectPromise) => {
          void runDaemon(cwd, { port: 0, onListening: state => resolvePromise(state.url) }).then(
            () => rejectPromise(new Error('the dev daemon exited before it bound')),
            rejectPromise,
          )
        })
        const bound = new URL(url)
        target = { hostname: bound.hostname, port: bound.port || '4200' }
        server.config.logger.info(`\n[openagent] dev daemon started at ${url} — starting runs is enabled\n`)
      })().catch((err: unknown) => {
        server.config.logger.error(
          `[openagent] dev daemon did not start (${err instanceof Error ? err.message : String(err)}); ` +
            `reads still work, but starting a run stays disabled`,
        )
      })

      // Registered up front (not after the await) so it sits ahead of Vite's own handling; the
      // request waits on `ready` when it arrives before the daemon has come up.
      server.middlewares.use((req, res, next) => {
        const url = req.originalUrl ?? req.url ?? ''
        // The modules' files (#1774) are the daemon's too: it finds them in the projects' packages, and the computer's in its own.
        if (!url.startsWith('/_rpc') && !url.startsWith('/_modules/') && !url.startsWith('/_computer-modules/')) return next()
        const forward = (dest: { hostname: string; port: string }): void => {
          // Host header left as the browser sent it (localhost:<devport>), so the daemon's same-origin
          // guard passes; the SSE stream just rides the piped response.
          const proxyReq = http.request(
            { hostname: dest.hostname, port: dest.port, method: req.method, path: url, headers: req.headers },
            proxyRes => {
              res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
              proxyRes.pipe(res)
            },
          )
          proxyReq.on('error', () => {
            if (!res.headersSent) {
              res.statusCode = 502
              res.end('openagent dev daemon proxy error')
            }
          })
          req.pipe(proxyReq)
        }
        if (target) return forward(target)
        // Daemon still coming up, or it failed: once `ready` settles, proxy if it is up, otherwise
        // fall through, which 404s the call rather than hanging it.
        void ready.then(() => (target ? forward(target) : next()))
      })
    },
  }
}

// What the dashboard shares with a module (#1774), beside React: the two names a module builds on,
// `@openagt/skill-ui/module`, which is also what the dashboard's own is built from, and the dashboard's own.
const SHARED: Record<string, HostFile> = {
  '@openagt/dashboard/module': { entry: 'module', file: fileURLToPath(new URL('./module/index.ts', import.meta.url)) },
  '@openagt/skill-ui/module': { entry: 'skill-ui', file: createRequire(import.meta.url).resolve('@openagt/skill-ui/module') },
}

// Dashboard (#405): a plain Vite SPA — React + Tailwind v4 + shadcn, talking to the daemon over
// plain HTTP (`POST /_rpc/<name>`, plus an SSE stream for the live feed). `index.html` beside this
// file is the whole entry; the daemon serves the built output as static files with an SPA fallback.
export default defineConfig({
  // The dashboard is a directory inside `packages/openagent` rather than a package of its own
  // (A7), so `root` is pinned to this file's directory instead of inherited from the cwd — the
  // scripts that run it live one level up.
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [openagentDevDaemon(), hostModules(SHARED), react(), tailwindcss()],
  build: {
    // Straight into the package's own dist, where the daemon serves it from. There used to be a
    // copy step between the two — a whole turbo task — because the bundle was built in a
    // different package.
    outDir: fileURLToPath(new URL('../dist/dashboard-bundle', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ...hostInputs(SHARED),
      },
      // The host entries are imported by name from outside the bundle, so their exports must survive.
      preserveEntrySignatures: 'exports-only',
    },
  },
  server: {
    port: 4300,
  },
} as UserConfig)

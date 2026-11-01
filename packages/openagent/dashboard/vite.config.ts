import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
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

// What the dashboard shares with a module (#1774). A module is a package that adds to the dashboard;
// it imports these by bare name and bundles none of them, and the import map this plugin writes into
// index.html points each name at the dashboard's own copy, so the module renders in the same React and
// uses the same components. Each is built as an entry of its own that shares its chunks with the
// dashboard's main entry, fingerprinted like them (`/assets/host/<name>-<hash>.js`): the import map, in
// the page that is always asked for again, names this version's, so a browser keeps them for good and a
// page opened again asks for none of them.
//
// React ships as CommonJS, and a re-export of CommonJS (`export * from 'react'`) keeps none of its
// names, so each React entry is generated: its names are read off the very package the build uses,
// here, so an upgrade that adds a name can never leave it out. `@openagt/dashboard/module` is a real file.

const HOST_MODULES: Record<string, string> = {
  react: 'react',
  'react/jsx-runtime': 'react-jsx-runtime',
  'react-dom': 'react-dom',
  'react-dom/client': 'react-dom-client',
}
const HOST_PREFIX = 'virtual:openagent-host:'
const MODULE_API = fileURLToPath(new URL('./module/index.ts', import.meta.url))

function openagentHostModules(): Plugin {
  const require = createRequire(import.meta.url)
  let serving = false
  return {
    name: 'openagent:host-modules',
    configResolved(config) {
      serving = config.command === 'serve'
    },
    resolveId(id) {
      return id.startsWith(HOST_PREFIX) ? id : undefined
    },
    load(id) {
      if (!id.startsWith(HOST_PREFIX)) return undefined
      const spec = id.slice(HOST_PREFIX.length)
      const names = Object.keys(require(spec) as object).filter(name => name !== 'default')
      return [`import M from '${spec}'`, 'export default M', ...names.map(name => `export const ${name} = M.${name}`)].join('\n')
    },
    transformIndexHtml: {
      // After the bundle is written: the map names each host entry by its fingerprinted file.
      order: 'post',
      handler(_html, { bundle }) {
        const built = (name: string): string => {
          const chunk = Object.values(bundle ?? {}).find(output => output.type === 'chunk' && output.isEntry && output.name === name)
          if (!chunk) throw new Error(`the build wrote no ${name} entry`)
          return `/${chunk.fileName}`
        }
        const imports: Record<string, string> = {}
        for (const [spec, file] of Object.entries(HOST_MODULES)) imports[spec] = serving ? `/@id/${HOST_PREFIX}${spec}` : built(`host/${file}`)
        imports['@openagt/dashboard/module'] = serving ? `/@fs${MODULE_API}` : built('host/module')
        return [{ tag: 'script', attrs: { type: 'importmap' }, children: JSON.stringify({ imports }, null, 2), injectTo: 'head-prepend' }]
      },
    },
  }
}

// Dashboard (#405): a plain Vite SPA — React + Tailwind v4 + shadcn, talking to the daemon over
// plain HTTP (`POST /_rpc/<name>`, plus an SSE stream for the live feed). `index.html` beside this
// file is the whole entry; the daemon serves the built output as static files with an SPA fallback.
export default defineConfig({
  // The dashboard is a directory inside `packages/openagent` rather than a package of its own
  // (A7), so `root` is pinned to this file's directory instead of inherited from the cwd — the
  // scripts that run it live one level up.
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [openagentDevDaemon(), openagentHostModules(), react(), tailwindcss()],
  build: {
    // Straight into the package's own dist, where the daemon serves it from. There used to be a
    // copy step between the two — a whole turbo task — because the bundle was built in a
    // different package.
    outDir: fileURLToPath(new URL('../dist/dashboard-bundle', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'host/module': MODULE_API,
        ...Object.fromEntries(Object.entries(HOST_MODULES).map(([spec, file]) => [`host/${file}`, `${HOST_PREFIX}${spec}`])),
      },
      // The host entries are imported by name from outside the bundle, so their exports must survive.
      preserveEntrySignatures: 'exports-only',
    },
  },
  server: {
    port: 4300,
  },
} as UserConfig)

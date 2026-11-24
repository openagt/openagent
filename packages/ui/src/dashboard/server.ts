import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AppRoute } from '@openagt/hooks'
import { createServer as createSecureServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { serveClientBundle } from './static.js'
import { makeRpcMount, RPC_PREFIX, isSameOriginRequest, isExpectedHost, isSecureAddressRequest } from './rpc-serve.js'
import type { DashboardContext } from '../dashboard-rpc/context.js'
import { handleViewRequest, keepView, serveWebsite, VIEW_PREFIX } from './website.js'
import { requestPathname } from '../request-path.js'
import { BROUGHT_MODULES_PREFIX, COMPUTER_MODULES_PREFIX, MODULES_PREFIX, PAGE_SHEET_PATH, serveModuleFile, servePageSheet } from './module-serve.js'
import { handleScreenRequest, kept, SCREEN_PREFIX, type ScreenOf } from './screen.js'
import { SECURE_PORT, type SecureAddress } from '../secure-address.js'

/** Options for {@link startDashboard}. */
export interface DashboardOptions {
  /** Port to bind. Default `4200`; pass `0` for an ephemeral port. */
  port?: number
  /**
   * What every RPC acts through (rpc-serve.ts): the daemon's own closures, a Start among them, and
   * its long-lived sources, the quota's among them, which the dashboard stops when it closes.
   */
  context: DashboardContext
  /**
   * Serve the new dashboard bundle (#405) from this directory — the built SPA
   * (`index.html` + `assets/**`). The daemon also mounts the dashboard's RPC surface
   * at `/_rpc` (the calls + the live-event stream). Omit only for a broken install with
   * no built bundle, where the server reports the bundle is missing.
   */
  clientBundleDir?: string
  /**
   * Where the live screen of a run on this computer answers (screen.ts): what the `/_screen/*`
   * routes pass a watcher's calls on to. Absent leaves every screen route 404.
   */
  screen?: ScreenOf
  /**
   * The routes the modules on this computer answer (`app.route`, #2394): a path `/_<name>` and every
   * path below it, after the dashboard's own, which no module's shadows. Asked for on each call, so
   * a plugin switched on or off answers, or stops, at once. A route checks its caller itself: it is
   * how a program of another origin reaches a module (a browser extension's calls), so the
   * same-origin check that keeps other origins out of `/_rpc` is no guard of it.
   */
  routes?: () => Promise<readonly AppRoute[]>
  /**
   * The secure address (#1919): also answer over HTTPS on `port`, with the certificate made on
   * this computer for `name`. Absent serves plain HTTP only.
   */
  secure?: SecureAddress & { port: number }
  /**
   * The website's copy (#1919), served on the secure address beside the dashboard: its landing
   * page at `/` when the person picks it, and its other pages at their own paths.
   */
  websiteDir?: string
}

/** A running localhost dashboard: the built SPA + its RPC mount. */
export interface Dashboard {
  /** The URL this computer's own programs call it on. */
  readonly url: string
  /** The secure address's URL, the one to open in a browser, when it is answered. */
  readonly secureUrl?: string
  /** Stop the server. Idempotent. */
  close(): Promise<void>
}

/**
 * Start the localhost dashboard: a tiny `node:http` server that serves the built SPA (#405) and
 * mounts its RPC surface at `/_rpc` — the calls and the live-event stream. The dashboard reads a
 * run's own diary over that stream and steers the run through the files its tool reads, so there is
 * no in-process event stream here; the server is a static-bundle + RPC host. The RPCs run in the
 * daemon's own process, so `sendStart` / `sendStartedAgain` call the daemon's own closures through
 * {@link DashboardOptions.context}.
 */
export async function startDashboard(opts: DashboardOptions): Promise<Dashboard> {
  const port = opts.port ?? 4200
  const clientBundleDir = opts.clientBundleDir

  // What the RPCs act through is wired first: the daemon's own callers of them need it
  // whether or not a page is served.
  const { context } = opts
  const rpcMount = makeRpcMount(context)

  // A broken install ships no built bundle (the published package always does), so serve
  // 503 for everything rather than stand up a half-wired mount. Returning here lets the
  // main path below treat the bundle, mount, and quota as present with no re-checks.
  if (!clientBundleDir) {
    const server = createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' })
      res.end('the dashboard bundle is not installed')
    })
    return listenDashboard(server, port, () => closeServer(server))
  }

  const screenOf = opts.screen ? kept(opts.screen) : undefined

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const pathname = requestPathname(req)
    if (pathname === undefined) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request')
      return
    }
    // A run's live screen (screen.ts): a click on it acts in the agent's browser, so it carries
    // the same guard as the RPC mount.
    if (pathname === SCREEN_PREFIX || pathname.startsWith(`${SCREEN_PREFIX}/`)) {
      if (!guardBrowserOrigin(req, res) || !guardOwnPageFetch(req, res)) return
      void handleScreenRequest(req, res, pathname, screenOf).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('the screen failed')
        else res.destroy()
      })
      return
    }
    if (pathname === RPC_PREFIX || pathname.startsWith(`${RPC_PREFIX}/`)) {
      void rpcMount(req, res)
      return
    }
    // A project's dashboard modules (#1774): only the files of a package the project brings as a module.
    // The computer's modules are no project's, and are served by their package alone.
    // So are the ones OpenAgent brings to projects, from its own copy, for another computer's project.
    if ([COMPUTER_MODULES_PREFIX, BROUGHT_MODULES_PREFIX, MODULES_PREFIX].some(prefix => pathname.startsWith(`${prefix}/`))) {
      // Void-dispatched like the bundle: a throw here must answer, not take the daemon down (#938).
      void serveModuleFile(req, res, pathname).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('module file unreadable')
      })
      return
    }
    // The page's one sheet of classes, the dashboard's and its modules' (page-styles.ts).
    if (pathname === PAGE_SHEET_PATH) {
      void servePageSheet(req, res, clientBundleDir).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('page sheet unreadable')
      })
      return
    }
    const websiteDir = opts.websiteDir
    if (websiteDir && isSecureAddressRequest(req) && (pathname === VIEW_PREFIX || pathname.startsWith(`${VIEW_PREFIX}/`))) {
      handleViewRequest(req, res, pathname)
      return
    }
    // A module's route (`app.route`): a path of the dashboard's own was answered above.
    const routes = opts.routes
    if (routes && pathname.startsWith('/_')) {
      void routes()
        .then(async known => {
          const route = known.find(one => pathname === one.path || pathname.startsWith(`${one.path}/`))
          if (route) await route.handle(req, res)
          else servePage(req, res, pathname)
        })
        .catch(() => {
          if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('the route failed')
          else res.destroy()
        })
      return
    }
    servePage(req, res, pathname)
  }
  /** What is no route of the dashboard's nor of a module's: the website's copy, or the dashboard's page. */
  const servePage = (req: IncomingMessage, res: ServerResponse, pathname: string): void => {
    const websiteDir = opts.websiteDir
    if (websiteDir && isSecureAddressRequest(req)) {
      keepView(req, res)
      void serveWebsite(req, res, websiteDir, pathname)
        .then(served => (served ? undefined : serveClientBundle(req, res, clientBundleDir)))
        .catch(() => {
          if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('page unreadable')
        })
      return
    }
    void serveClientBundle(req, res, clientBundleDir)
  }
  const server = createServer(handle)
  const secureServer = opts.secure ? createSecureServer({ key: opts.secure.key, cert: opts.secure.cert }, handle) : undefined
  const close = async () => {
    // Stop polling with the server: the usage panel polls for the dashboard's whole life, not just
    // during an agent, to show where the account stands while nothing runs (#533), so nothing
    // else would ever end it.
    context.quota.stop()
    await Promise.all([closeServer(server), secureServer ? closeServer(secureServer) : undefined])
  }
  const dashboard = await listenDashboard(server, port, close)
  if (!opts.secure || !secureServer) return dashboard
  try {
    return { ...dashboard, secureUrl: secureUrlOf(opts.secure.name, await listen(secureServer, opts.secure.port)) }
  } catch (err) {
    // A secure address that cannot start leaves the dashboard on its plain address, as without one.
    console.log(`[openagent] the secure address ${opts.secure.name} could not start (${err instanceof Error ? err.message : String(err)}): the dashboard answers on ${dashboard.url} only`)
    return dashboard
  }
}

/**
 * The secure address's URL. On {@link SECURE_PORT} it has no port: the install sends the name's
 * port 443 there. Any other port (a test's own) is said.
 */
function secureUrlOf(name: string, port: number): string {
  return port === SECURE_PORT ? `https://${name}` : `https://${name}:${port}`
}

/**
 * The one address the dashboard listens on, its secure address too: this computer's own. Whatever
 * opens OpenAgent to a network is a package of its own, which listens there and passes what it
 * lets in on to here.
 */
const DASHBOARD_HOST = '127.0.0.1'

/** Bind the server and resolve a {@link Dashboard} handle; rejects if the port is already taken. */
async function listenDashboard(server: Server, port: number, close: () => Promise<void>): Promise<Dashboard> {
  return { url: `http://${DASHBOARD_HOST}:${await listen(server, port)}`, close }
}

/** Bind the server on this computer's own address; resolves the port bound, rejects if it is taken. */
function listen(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, DASHBOARD_HOST, () => {
      server.removeListener('error', rejectPromise)
      resolvePromise((server.address() as AddressInfo).port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  // Force-close keep-alive + streaming sockets (e.g. an open /_rpc/events body) so close() resolves instead of waiting on them.
  server.closeAllConnections()
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}

/**
 * A watched screen makes the run's computer draw pictures, and watching is a plain GET, which a
 * browser sends with no `Origin`. So a screen's routes also read what a browser says of where a
 * request comes from: one another site's page made, and one that is the address bar's own (a
 * download with no end), is turned away. A browser that says nothing is let by, as before.
 * Returns true to admit; on rejection it has answered 403.
 */
function guardOwnPageFetch(req: IncomingMessage, res: ServerResponse): boolean {
  const site = req.headers['sec-fetch-site']
  if ((site === undefined || site === 'same-origin') && req.headers['sec-fetch-mode'] !== 'navigate') return true
  res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
  return false
}

/**
 * The CSRF + DNS-rebinding guard the RPC mount applies, lifted to a run's screen, which is served
 * outside it. A click on a screen acts in the agent's browser, so without this a page the user
 * merely visited reaches it. Returns true to admit the request; on rejection it has already
 * answered 403.
 */
function guardBrowserOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (isSameOriginRequest(req) && isExpectedHost(req)) return true
  res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
  return false
}

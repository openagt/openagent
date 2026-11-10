import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { serveClientBundle } from './static.js'
import { makeRpcMount, RPC_PREFIX, isSameOriginRequest, isExpectedHost, isJsonRequest, isSecureAddressRequest } from './rpc-serve.js'
import type { DashboardContext } from '../dashboard-rpc/context.js'
import { handleViewRequest, keepView, serveWebsite, VIEW_PREFIX } from './website.js'
import { requestPathname } from '../request-path.js'
import { BROUGHT_MODULES_PREFIX, COMPUTER_MODULES_PREFIX, MODULES_PREFIX, serveBroughtModuleFile, serveComputerModuleFile, serveModuleFile } from './module-serve.js'
import { handleRelayRequest, RELAY_PREFIX, type RelayHandlers } from './relay-endpoints.js'
import { noteOwnersName, OWNERS_NAME_HEADER } from './machine-call.js'
import { handleScreenRequest, kept, SCREEN_PREFIX, type ScreenHandlers } from './screen.js'
import { BRIDGE_PREFIX, EXPECTED_EXTENSION_VERSION, handleBridgeRequest, type BridgeHandlers, type BridgeSession } from './bridge-endpoints.js'
import { bridgeQuestions } from './bridge-store.js'
import { bridgeStarts } from './bridge-starts.js'
import { WEB_START_PREFIX, handleWebStartRequest, type WebStartHandlers } from './web-start-endpoints.js'
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
   * Serve a relay-started run's events back to the daemon that relayed it here (#1067): the
   * `/_relay/*` endpoints (start, events, the slice-2 `rpc`, the machine-wide calls, a run's screen,
   * and a project asked for), a start going to the context's `startAgent` and a screen to
   * {@link screen}. The daemon listens on its own computer only, so a call from another machine
   * reaches them through whatever this computer opened to the network, which lets in only a
   * machine that holds a key of its own.
   */
  relay?: Omit<RelayHandlers, 'start' | 'screen'>
  /**
   * Where the live screen of a run on this computer answers (screen.ts): what the `/_screen/*`
   * routes, and the relay's for another machine, pass a watcher's calls on to. Absent leaves
   * every screen route 404.
   */
  screen?: (projectId: string, agentId: string) => Promise<string | undefined>
  /**
   * The browser bridge (#1237): the token a Claude web extension presents to report the question
   * its cloud session is parked on. Absent leaves every `/_bridge/*` route 404, which is default.
   *
   * What keeps other origins out of `/_rpc` is the same-origin check. The bridge is the one
   * route meant to be reached from another origin, so that check does not protect it and it
   * authenticates on its own.
   */
  bridgeToken?: string
  /**
   * The cloud sessions the browser bridge should have a tab open for (#1237). Only the daemon
   * wires one, since it is the process that can see every project's runs.
   */
  bridgeSessions?: () => Promise<BridgeSession[]>
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
 * daemon's own process, so `sendStart` / `sendAddProject` call the daemon's own closures through
 * {@link DashboardOptions.context}.
 */
export async function startDashboard(opts: DashboardOptions): Promise<Dashboard> {
  const port = opts.port ?? 4200
  const clientBundleDir = opts.clientBundleDir

  // What the RPCs act through is wired first: the daemon's own callers of them (its syncs) need it
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

  // The machine-to-daemon relay endpoints (#1067): wired only when an events tail is supplied.
  const localScreen = opts.screen ? kept(opts.screen) : undefined
  const relayHandlers: RelayHandlers | undefined = opts.relay ? { ...opts.relay, start: context.startAgent, ...(localScreen ? { screen: localScreen } : {}) } : undefined
  const screenHandlers: ScreenHandlers | undefined = localScreen ? { local: localScreen, remote: (projectId, agentId) => context.remote.target(agentId, projectId) } : undefined

  // The browser bridge (#1237). Off unless a token was supplied, and it carries that token itself.
  const bridgeHandlers: BridgeHandlers | undefined = opts.bridgeToken
    ? {
        token: opts.bridgeToken,
        // The version gate (#1519): a stale extension is refused loudly rather than half-working.
        expectedExtensionVersion: EXPECTED_EXTENSION_VERSION,
        extensionVersion: (got, blocked) => bridgeQuestions().recordVersion(got, EXPECTED_EXTENSION_VERSION, blocked),
        record: question => bridgeQuestions().record(question),
        contact: (route, status) => bridgeQuestions().recordContact(route, status),
        recordEvent: event => bridgeQuestions().recordEvent(event),
        hello: hello => bridgeQuestions().recordHello(hello),
        statuses: statuses => {
          for (const status of statuses) bridgeQuestions().recordStatus(status)
        },
        // Claimed on read (#1332), like a start: two Drivers asking must not both type it.
        answer: sessionId => {
          const pending = bridgeQuestions().claimAnswer(sessionId)
          return pending ? { id: pending.id, text: pending.text } : undefined
        },
        answered: (sessionId, id, ok, note) => bridgeQuestions().resolveAnswer(sessionId, id, ok, note),
        // The session start-queue (#1328). The claim happens inside claimNext, not in the route:
        // two polling tabs handed the same request would create two cloud sessions.
        start: () => {
          const next = bridgeStarts().claimNext()
          return next ? { id: next.id, repo: next.repo, branch: next.branch, prompt: next.prompt, ...(next.model ? { model: next.model } : {}) } : undefined
        },
        started: (id, ok, sessionId, note) => bridgeStarts().resolve(id, ok, sessionId, note),
        ...(opts.bridgeSessions ? { sessions: opts.bridgeSessions } : {}),
      }
    : undefined

  // The run-facing side of the same queue (#1328): a spawned web run asks here, on the same token.
  const webStartHandlers: WebStartHandlers | undefined = opts.bridgeToken
    ? {
        token: opts.bridgeToken,
        extensionAlive: () => bridgeQuestions().extensionAlive(),
        request: input => bridgeStarts().request(input),
        get: id => bridgeStarts().get(id),
      }
    : undefined

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const pathname = requestPathname(req)
    if (pathname === undefined) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request')
      return
    }
    // A person's own OpenAgent on a computer several people use goes by the name its owner gave the
    // computer: the door says it with each call it passes on.
    noteOwnersName(req.headers[OWNERS_NAME_HEADER])
    // The browser bridge (#1237) presents its own bearer token.
    if (pathname === BRIDGE_PREFIX || pathname.startsWith(`${BRIDGE_PREFIX}/`)) {
      void handleBridgeRequest(req, res, pathname, bridgeHandlers)
      return
    }
    if (pathname === WEB_START_PREFIX || pathname.startsWith(`${WEB_START_PREFIX}/`)) {
      void handleWebStartRequest(req, res, pathname, webStartHandlers)
      return
    }
    // The machine relay (#1067): another daemon posts a start here and streams the run's events back.
    // Exactly like the RPC mount below, the relay carries its own CSRF + DNS-rebinding guard, or a
    // page the user merely visited could POST /_relay/start to start a run (a machine's call
    // arrives with no Origin and a loopback Host, so both checks pass it; only a browser's
    // cross-origin/rebound request is turned away).
    // And like the RPC mount, a call that changes something says its body is JSON: a page another
    // program serves on this computer passes the origin check, and a browser sends its POST
    // unasked only while it is not JSON. Every machine's call is.
    if (pathname === RELAY_PREFIX || pathname.startsWith(`${RELAY_PREFIX}/`)) {
      if (!guardBrowserOrigin(req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD' && !isJsonRequest(req)) {
        res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
        return
      }
      void handleRelayRequest(req, res, pathname, relayHandlers)
      return
    }
    // A run's live screen (screen.ts): a click on it acts in the agent's browser, so it carries
    // the same guard as the RPC mount.
    if (pathname === SCREEN_PREFIX || pathname.startsWith(`${SCREEN_PREFIX}/`)) {
      if (!guardBrowserOrigin(req, res) || !guardOwnPageFetch(req, res)) return
      void handleScreenRequest(req, res, pathname, screenHandlers).catch(() => {
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
    const ofComputer = pathname.startsWith(`${COMPUTER_MODULES_PREFIX}/`)
    const brought = pathname.startsWith(`${BROUGHT_MODULES_PREFIX}/`)
    if (ofComputer || brought || pathname.startsWith(`${MODULES_PREFIX}/`)) {
      // Void-dispatched like the bundle: a throw here must answer, not take the daemon down (#938).
      void (ofComputer ? serveComputerModuleFile : brought ? serveBroughtModuleFile : serveModuleFile)(req, res, pathname).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('module file unreadable')
      })
      return
    }
    const websiteDir = opts.websiteDir
    if (websiteDir && isSecureAddressRequest(req)) {
      if (pathname === VIEW_PREFIX || pathname.startsWith(`${VIEW_PREFIX}/`)) {
        handleViewRequest(res, pathname)
        return
      }
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
    console.log(`the secure address ${opts.secure.name} could not start (${err instanceof Error ? err.message : String(err)}): the dashboard answers on ${dashboard.url} only`)
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
  // Force-close keep-alive + streaming sockets (e.g. an open /_relay/events body, #1067) so close() resolves instead of waiting on them.
  server.closeAllConnections()
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}

/**
 * A watched screen makes the run's computer draw pictures, and watching is a plain GET, which a
 * browser sends with no `Origin`. So a screen's routes also read what a browser says of where a
 * request comes from: one another site's page made, and one that is the address bar's own (a
 * download with no end), is turned away. A browser that says nothing (a page reached over plain
 * HTTP on the Wi-Fi) is let by, as before. Returns true to admit; on rejection it has answered 403.
 */
function guardOwnPageFetch(req: IncomingMessage, res: ServerResponse): boolean {
  const site = req.headers['sec-fetch-site']
  if ((site === undefined || site === 'same-origin') && req.headers['sec-fetch-mode'] !== 'navigate') return true
  res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
  return false
}

/**
 * The CSRF + DNS-rebinding guard the RPC mount applies, lifted to the machine relay, which
 * dispatches outside it. The relay is state-changing (it starts a run on this machine), so
 * without this a page the user merely visited reaches it. Returns true to admit the request; on rejection
 * it has already answered 403.
 */
function guardBrowserOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (isSameOriginRequest(req) && isExpectedHost(req)) return true
  res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
  return false
}

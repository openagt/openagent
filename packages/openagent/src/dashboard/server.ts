import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { PreferencesStore } from '../registry.js'
import type { QuotaSource } from './quota.js'
import type { ModelsSource } from './models.js'
import type { ProjectErrorsReader } from '../project-errors.js'
import type { BridgeBrowserOwner } from '../bridge-browser.js'
import { serveClientBundle } from './static.js'
import { makeRpcMount, RPC_PREFIX, isSameOriginRequest, isExpectedHost } from './rpc-serve.js'
import { requestPathname } from '../request-path.js'
import { MODULES_PREFIX, serveModuleFile } from './module-serve.js'
import type { AddProjectResult, RemoveProjectResult, StartAgentOptions, StartAgentResult } from './types.js'
import type { EventsSource, RemoteAgents } from './rpc-serve.js'
import { handleRelayRequest, RELAY_PREFIX, type RelayHandlers } from './relay-endpoints.js'
import { BRIDGE_PREFIX, EXPECTED_EXTENSION_VERSION, handleBridgeRequest, type BridgeHandlers } from './bridge-endpoints.js'
import { bridgeQuestions } from './bridge-store.js'
import { bridgeStarts } from './bridge-starts.js'
import { WEB_START_PREFIX, handleWebStartRequest, type WebStartHandlers } from './web-start-endpoints.js'

/** Options for {@link startDashboard}. */
export interface DashboardOptions {
  /** Port to bind. Default `4200`; pass `0` for an ephemeral port. */
  port?: number
  /** Host to bind. Default `127.0.0.1` (localhost only). */
  host?: string
  /**
   * Called when the browser starts a run (#345): the `sendStart` RPC reaches this through the
   * wired dashboard context. Wire it to the project's start hook.
   */
  onStart: (
    prompt: string,
    options: StartAgentOptions,
    projectId?: string,
  ) => StartAgentResult | Promise<StartAgentResult>
  /**
   * Called when the browser adds a project (#396): the `sendAddProject` RPC reaches this through
   * the wired dashboard context. Wire it to install the repo and register it.
   */
  onAddProject: (path: string, share: boolean) => Promise<AddProjectResult> | AddProjectResult
  /** Called when the browser removes a project: the `sendRemoveProject` RPC reaches this through the wired dashboard context. */
  onRemoveProject: (projectId: string, files: boolean) => Promise<RemoveProjectResult> | RemoveProjectResult
  /**
   * The user-preferences store (#410): the `onPreferences` / `savePreferences` RPCs read and
   * write it through the wired dashboard context.
   */
  preferences: PreferencesStore
  /** Where the usage panel reads the quota from (#533). */
  quota: QuotaSource
  /** Which models each coding agent offers, for the agent and model menu. */
  models: ModelsSource
  /** What a project currently suffers from (#1500), for the project list to carry. */
  projectErrors: ProjectErrorsReader
  /** The daemon's own bridge browser (#1332): its status, and the show/hide/restart the settings page asks for. */
  bridgeBrowser: BridgeBrowserOwner
  /**
   * Serve the new dashboard bundle (#405) from this directory — the built SPA
   * (`index.html` + `assets/**`). The daemon also mounts the dashboard's RPC surface
   * at `/_rpc` (the calls + the live-event stream). Omit only for a broken install with
   * no built bundle, where the server reports the bundle is missing.
   */
  clientBundleDir?: string
  /**
   * The shared token that guards a non-loopback bind (#1051): with it set, every route (static
   * bundle, `/_rpc`, `/_relay`) needs a valid `oa_daemon` cookie or a matching
   * `?token=`, else 401. Omit for a loopback bind, where the guard is a no-op and local UX is
   * byte-identical. A separate concern from the CSRF origin check in rpc-serve.ts.
   */
  token?: string
  /**
   * The live-events source for a run this daemon is relaying from a saved machine (#1067):
   * a stream for such a run, else undefined so `onEvents` tails the run's diary off disk.
   */
  eventsSource: EventsSource
  /**
   * The relayed-agent lookup the read RPCs consult (#1067 slice 2). A run-scoped RPC uses it to
   * forward a remote agent's read/steer/handoff to the machine that owns it.
   */
  remote: RemoteAgents
  /**
   * Serve a relay-started run's events back to the daemon that relayed it here (#1067): the
   * `/_relay/*` endpoints (start + events, plus the slice-2 `rpc`). All are fronted by the same
   * `token` guard above, so a machine without the cookie cannot start or read a run.
   */
  relay?: {
    /** This machine's own id for its project cloned from an address, which is how a relayed call names one. */
    project: (address: string) => Promise<string | undefined>
    tailEvents: (projectId: string, agentId: string, onEvent: (event: import('../events.js').OpenAgentEvent) => void) => () => void
    /** Run one whitelisted run-scoped RPC against this daemon's own checkout (#1067 slice 2). */
    rpc?: (projectId: string, fn: string, args: unknown[]) => Promise<unknown>
  }
  /**
   * The browser bridge (#1237): the token a Claude web extension presents to report the question
   * its cloud session is parked on. Absent leaves every `/_bridge/*` route 404, which is default.
   *
   * Deliberately not {@link token}. That one guards a non-loopback bind and is absent on a normal
   * loopback daemon, where what keeps other origins out of `/_rpc` is the same-origin check.
   * The bridge is the one route meant to be reached from another origin, so neither protects it
   * and it authenticates on its own.
   */
  bridgeToken?: string
  /**
   * The cloud sessions the browser bridge should have a tab open for (#1237). Only the daemon
   * wires one, since it is the process that can see every project's runs.
   */
  bridgeSessions?: () => Promise<import('./bridge-endpoints.js').BridgeSession[]>
}

/** A running localhost dashboard: the built SPA + its RPC mount. */
export interface Dashboard {
  /** The URL to open. */
  readonly url: string
  /** Stop the server. Idempotent. */
  close(): Promise<void>
}

/**
 * Start the localhost dashboard: a tiny `node:http` server that serves the built SPA (#405) and
 * mounts its RPC surface at `/_rpc` — the calls and the live-event stream. The dashboard reads a
 * run's own diary over that stream and steers the run through the files its tool reads, so there is
 * no in-process event stream here; the server is a static-bundle + RPC host. The RPCs run in the
 * daemon's own process, so `sendStart` / `sendAddProject` call the daemon's own closures via
 * {@link DashboardOptions.onStart} / {@link DashboardOptions.onAddProject}.
 */
export function startDashboard(opts: DashboardOptions): Promise<Dashboard> {
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 4200
  const clientBundleDir = opts.clientBundleDir

  // A broken install ships no built bundle (the published package always does), so serve
  // 503 for everything rather than stand up a half-wired mount. Returning here lets the
  // main path below treat the bundle, mount, and quota as present with no re-checks.
  if (!clientBundleDir) {
    const server = createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' })
      res.end('the dashboard bundle is not installed')
    })
    return listenDashboard(server, host, port, () => closeServer(server))
  }

  // The usage panel polls for the dashboard's whole life, not just during an agent:
  // it has to show where the account stands while nothing is running (#533).
  const quota = opts.quota
  const rpcMount = makeRpcMount(
    {
      startAgent: opts.onStart,
      addProject: opts.onAddProject,
      removeProject: opts.onRemoveProject,
      eventsSource: opts.eventsSource,
      remote: opts.remote,
      preferences: opts.preferences,
      projectErrors: opts.projectErrors,
      bridgeBrowser: opts.bridgeBrowser,
      quota,
      models: opts.models,
    },
    // The bound host, so the mount can reject a rebound `Host`: a page on evil.com whose DNS
    // answers 127.0.0.1 is same-origin to the browser, so the Origin check alone lets it in.
    { host },
  )

  // The machine-to-daemon relay endpoints (#1067): wired only when an events tail is supplied.
  // Fronted by the same token guard as every other route below.
  const relayHandlers: RelayHandlers | undefined = opts.relay
    ? { project: opts.relay.project, start: opts.onStart, tailEvents: opts.relay.tailEvents, ...(opts.relay.rpc ? { rpc: opts.relay.rpc } : {}) }
    : undefined

  // The browser bridge (#1237). Off unless a token was supplied, and it carries that token itself
  // rather than riding the shared-token guard (#1051), which a loopback daemon does not have.
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

  const token = opts.token
  const server = createServer((req, res) => {
    const pathname = requestPathname(req)
    if (pathname === undefined) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request')
      return
    }
    // The browser bridge (#1237) is checked BEFORE the shared-token guard (#1051), and is the only route that is.
    // That guard's browser affordance is a `?token=` redirect meant for a human following a link,
    // which is meaningless to an extension posting JSON; the bridge presents its own bearer token
    // instead, so letting it past here costs nothing and skips a 302 it could not follow.
    if (pathname === BRIDGE_PREFIX || pathname.startsWith(`${BRIDGE_PREFIX}/`)) {
      void handleBridgeRequest(req, res, pathname, bridgeHandlers)
      return
    }
    if (pathname === WEB_START_PREFIX || pathname.startsWith(`${WEB_START_PREFIX}/`)) {
      void handleWebStartRequest(req, res, pathname, webStartHandlers)
      return
    }
    // #1051: one guard fronting every route on a non-loopback bind; a no-op when no token is set.
    if (token !== undefined && !authorizeDaemonRequest(req, res, token)) return
    // The machine relay (#1067): another daemon posts a start here and streams the run's events back.
    // The token guard above is a no-op on a loopback bind, so — exactly like the RPC mount below —
    // the relay carries its own CSRF + DNS-rebinding guard, or a page the user merely visited could
    // POST /_relay/start to start a run (the real machine caller sends no Origin and a loopback
    // Host, so both checks pass it; only a browser's cross-origin/rebound request is turned away).
    if (pathname === RELAY_PREFIX || pathname.startsWith(`${RELAY_PREFIX}/`)) {
      if (!guardBrowserOrigin(req, res, host)) return
      void handleRelayRequest(req, res, pathname, relayHandlers)
      return
    }
    if (pathname === RPC_PREFIX || pathname.startsWith(`${RPC_PREFIX}/`)) {
      void rpcMount(req, res)
      return
    }
    // A project's dashboard modules (#1774): only the files of a package the project brings as a module.
    if (pathname.startsWith(`${MODULES_PREFIX}/`)) {
      // Void-dispatched like the bundle: a throw here must answer, not take the daemon down (#938).
      void serveModuleFile(req, res, pathname).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('module file unreadable')
      })
      return
    }
    void serveClientBundle(req, res, clientBundleDir)
  })
  return listenDashboard(server, host, port, async () => {
    // Stop polling with the server: the poller outlives every agent by design,
    // so nothing else would ever end it.
    quota.stop()
    await closeServer(server)
  })
}

/** Bind the server and resolve a {@link Dashboard} handle; rejects if the port is already taken. */
function listenDashboard(server: Server, host: string, port: number, close: () => Promise<void>): Promise<Dashboard> {
  return new Promise<Dashboard>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, host, () => {
      server.removeListener('error', rejectPromise)
      const address = server.address() as AddressInfo
      resolvePromise({ url: `http://${host}:${address.port}`, close })
    })
  })
}

function closeServer(server: Server): Promise<void> {
  // Force-close keep-alive + streaming sockets (e.g. an open /_relay/events body, #1067) so close() resolves instead of waiting on them.
  server.closeAllConnections()
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}

/**
 * The CSRF + DNS-rebinding guard the RPC mount applies, lifted to the machine relay, which
 * dispatches outside it. The relay is state-changing (it starts a run on this machine) and is
 * wired unconditionally on a loopback bind, where the shared-token guard is a no-op, so without
 * this a page the user merely visited reaches it. Returns true to admit the request; on rejection
 * it has already answered 403.
 */
function guardBrowserOrigin(req: IncomingMessage, res: ServerResponse, host: string): boolean {
  if (isSameOriginRequest(req) && isExpectedHost(req, host)) return true
  res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
  return false
}

/** The cookie a bootstrapped browser carries on every same-origin request (#1051). */
const DAEMON_COOKIE = 'oa_daemon'

/**
 * The non-loopback bind guard (#1051): a request needs a valid `oa_daemon` cookie or a matching
 * `?token=`, else 401. A valid `?token=` sets the cookie and 302s to the clean path so the token
 * leaves the URL bar, history, and Referer after one hop; the cookie then rides RPC, the events
 * Channel, and the MJPEG `<img>` screencast alike (all same-origin), which a bearer header cannot
 * reach. Returns true to admit the request, false once it has answered (401 or the redirect).
 */
function authorizeDaemonRequest(req: IncomingMessage, res: ServerResponse, token: string): boolean {
  // Safe to re-parse: requestPathname already parsed this same url without throwing (#938).
  const url = new URL(req.url ?? '/', 'http://localhost')
  const queryToken = url.searchParams.get('token')
  if (queryToken !== null && tokensMatch(queryToken, token)) {
    url.searchParams.delete('token')
    const query = url.searchParams.toString()
    res.writeHead(302, {
      // Lax, not Strict: opening this address from a link (#1052) is a cross-origin top-level nav, and a Strict cookie set on it is withheld from the redirect right after, so the clean path 401s. Lax still rides top-level GET navs; CSRF stays covered by the same-origin check on /_rpc.
      'set-cookie': `${DAEMON_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`,
      location: url.pathname + (query ? `?${query}` : ''),
    })
    res.end()
    return false
  }
  const cookieToken = readCookie(req.headers.cookie, DAEMON_COOKIE)
  if (cookieToken !== undefined && tokensMatch(cookieToken, token)) return true
  res.writeHead(401, { 'content-type': 'text/plain' })
  res.end('unauthorized')
  return false
}

/** Constant-time token compare (#1051). The length check first, since `timingSafeEqual` throws on
 * unequal-length buffers and a length mismatch cannot be a match anyway. */
function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** One cookie's value out of a `Cookie` header, or `undefined`. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

import type { IncomingMessage, ServerResponse } from 'node:http'
import { hostnameFromHostHeader, isLoopbackHost } from '../loopback-host.js'
import { setDashboardContext } from '../dashboard-rpc/context.js'
import { RPC_HANDLERS, RPC_EVENT_STREAM } from '../dashboard-rpc/index.js'
import { errorMessage } from '../error-message.js'
import type { OpenAgentEvent } from '../events.js'
import type { PreferencesStore } from '../registry.js'
import type { QuotaSource } from './quota.js'
import type { ModelsSource } from './models.js'
import type { BridgeBrowserOwner } from '../bridge-browser.js'
import type { ProjectErrorsReader } from '../project-errors.js'
import type { AddProjectResult, RemoveProjectResult, StartAgentOptions, StartAgentResult } from './types.js'
import type { AgentMeta } from '../store/index.js'
import type { RemoteTarget } from './remote-run.js'

/** Wired by the daemon so `sendStart` can reach the daemon's own `startAgent` closure. */
export type StartAgentHandler = (
  prompt: string,
  options: StartAgentOptions,
  projectId?: string,
) => StartAgentResult | Promise<StartAgentResult>

/** Wired by the daemon so `sendAddProject` can install + register a repo (#433). */
export type AddProjectHandler = (path: string, share: boolean) => AddProjectResult | Promise<AddProjectResult>

/** Wired by the daemon so `sendRemoveProject` can take a project off the list, by its id, and with `files` remove what OpenAgent left in its folder. */
export type RemoveProjectHandler = (projectId: string, files: boolean) => RemoveProjectResult | Promise<RemoveProjectResult>

/** Resolve an agent to its live event stream: the relay feeds `onEvents` from its own in-memory stream
 * rather than a file on disk (#426), and the daemon feeds an agent it is relaying from a machine (#1067).
 * Returns undefined when there is no in-memory stream, so `onEvents` falls back to tailing the log. */
export type EventsSource = (projectId: string, agentId?: string) => AsyncIterable<OpenAgentEvent> | undefined

/** Look up the machine a relayed agent (#1067) executes on, or undefined for an ordinary local agent. The
 *  daemon wires this from its live relayed-agent map; a run-scoped RPC uses it to forward a remote agent's
 *  read/steer/handoff to that machine instead of resolving a (nonexistent) local checkout. */
export interface RemoteAgents {
  target(agentId: string | undefined): RemoteTarget | undefined
  /** A project's relayed run stubs (#1077), so `onAgents` can show a remote agent in the list and re-open it after a reload. */
  list(projectId: string): AgentMeta[]
}

/**
 * What every RPC acts through.
 *
 * Every field is required (D3). These used to be optional because three hosts served this same
 * surface — the daemon, a per-session foreground dashboard, and a public relay — each wiring a
 * different subset, so every RPC carried an "absent capability" branch and the client rendered a
 * degradation matrix. There is one host now, and it wires all of it.
 */
export interface DashboardContext {
  startAgent: StartAgentHandler
  addProject: AddProjectHandler
  removeProject: RemoveProjectHandler
  /** The in-memory event stream for an agent relayed from a saved machine (#1067), else undefined. */
  eventsSource: EventsSource
  /** The relayed-agent lookup (#1067 slice 2), so a run-scoped RPC can tell a local agent from one
   *  running on a saved machine and forward the call there. */
  remote: RemoteAgents
  /** The user-preferences store (#410), over the registry file. */
  preferences: PreferencesStore
  /** The quota source behind the usage panel (#533). */
  quota: QuotaSource
  /** Which models each coding agent offers, for the agent and model menu. */
  models: ModelsSource
  /** What a project currently suffers from (#1500): the daemon's error state, read per project. */
  projectErrors: ProjectErrorsReader
  /** The daemon's own bridge browser (#1332): status, and show/hide/restart on request. */
  bridgeBrowser: BridgeBrowserOwner
}

/**
 * CSRF guard for the state-changing RPCs. A browser attaches an `Origin`
 * header to every cross-site request, so we reject any POST whose Origin is not this
 * same server (or a loopback host) — otherwise a page on `evil.com` could `fetch()` the
 * localhost dashboard and start or steer a run. An absent Origin means a non-browser caller
 * (curl, the test suite) with no ambient session to abuse, so it passes. Lives here beside
 * the mount, its only caller.
 */
export function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false // malformed Origin: treat as cross-origin
  }
  return isLoopbackHost(hostname)
}

/**
 * DNS-rebinding guard, the other half of the CSRF check above. A page on `evil.com` whose DNS
 * re-answers as `127.0.0.1` is *same-origin* with this server as far as the browser is concerned,
 * so its `fetch()` takes the passing branch of {@link isSameOriginRequest} — and every RPC behind
 * the mount, `sendStart` included, is reachable from a page the user merely visited.
 *
 * The `Host` header is what still gives the attacker away: it carries the name the browser was
 * asked for (`evil.com`), not the address it resolved to. So when we are bound to loopback, the
 * only `Host` a real user's browser can send is a loopback one (or the bound address itself) —
 * anything else is a rebound name and is rejected. An absent `Host` is rejected too when we are
 * enforcing: HTTP/1.1 requires it, and every browser sends it.
 *
 * A non-loopback bind (`--host`, #1051) is reached by a hostname we cannot predict, so there is
 * no allowlist to check against; that case gates behind the shared daemon token instead. Hosts
 * that never pass a bind host at all (the relay, which serves a public domain) are unaffected.
 */
export function isExpectedHost(req: IncomingMessage, boundHost: string | undefined): boolean {
  if (boundHost === undefined || !isLoopbackHost(boundHost)) return true
  const header = req.headers.host
  if (!header) return false
  const hostname = hostnameFromHostHeader(header)
  return isLoopbackHost(hostname) || hostname === boundHost
}

/** Where the dashboard's RPCs live. One prefix, so the static handler can decline it by path. */
export const RPC_PREFIX = '/_rpc'

/** Read a request body, bounded so a bad caller cannot make the daemon buffer without limit. */
async function readBody(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(text)
}

/**
 * Stream an agent's events as Server-Sent Events (#405). One JSON value per `data:` line; the
 * response ending IS the clean close the client distinguishes from a dropped connection.
 *
 * This was a Telefunc Channel. The Channel gave serialization, reconnect and typing over a
 * WebSocket-shaped abstraction; what the dashboard actually uses is "push me lines until I go
 * away", and it brought its own reconnect-with-backoff on top (#948/#1383) because the Channel's
 * did not distinguish a dead daemon from a finished stream.
 */
async function serveEventStream(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get('projectId') ?? ''
  const agentId = url.searchParams.get('agentId') ?? undefined
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // The daemon is behind nothing, but a proxy in front of a `--host` bind would otherwise buffer.
    'x-accel-buffering': 'no',
  })
  let finished = false
  const stop = await RPC_EVENT_STREAM(
    projectId,
    agentId,
    value => {
      res.write(`data: ${JSON.stringify(value)}\n\n`)
    },
    () => {
      finished = true
      res.end()
    },
  )
  if (!stop) {
    // Nothing to stream (unknown project): end cleanly, which the client reads as "done", not
    // "lost" — the same distinction the Channel's clean-vs-errored close carried.
    res.end()
    return
  }
  if (finished) return // the source was exhausted before it was even wired
  const finish = (): void => {
    stop()
    res.end()
  }
  req.on('close', finish)
  req.on('error', finish)
}

/**
 * Mount the dashboard's RPC surface (#405) on the daemon's `node:http` server: `POST /_rpc/<name>`
 * for the calls, `GET /_rpc/events` for the live stream. It runs in the daemon process, so
 * `sendStart` reaches the daemon's own `startAgent` through the wired {@link DashboardContext}.
 *
 * Cross-origin POSTs are rejected (CSRF: a page on evil.com must not steer or start a session), as
 * are requests carrying someone else's `Host` when we are bound to loopback (DNS rebinding: the
 * same page must not reach us by pointing its own name at `127.0.0.1`). Pass `opts.host` — the
 * address the server is bound to — to enable that second check. Returns whether the request was
 * the RPC surface's.
 *
 * This replaced Telefunc (F3), which required a build-time transform over every `.telefunc.ts`
 * file, a registration table pinning each RPC to the client-baked key of the *dashboard* source
 * path it was re-exported from, and a request-context indirection for wiring that never varied
 * per request. What it bought over this was type-safety across a package boundary that A7 removed.
 */
export function makeRpcMount(
  context: DashboardContext,
  opts: { host?: string } = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  setDashboardContext(context)
  return async (req, res) => {
    // A fixed base, like every other request parse here: only the path and the query are read,
    // and a request carrying an empty or malformed `Host` made this throw — outside the handler's
    // own try, so the daemon died of the unhandled rejection rather than answering the request.
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== RPC_PREFIX && !url.pathname.startsWith(`${RPC_PREFIX}/`)) return false
    if (!isSameOriginRequest(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('cross-origin request forbidden')
      return true
    }
    if (!isExpectedHost(req, opts.host)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('unexpected Host header')
      return true
    }

    const name = url.pathname.slice(RPC_PREFIX.length + 1)
    try {
      if (req.method === 'GET' && name === 'events') {
        await serveEventStream(req, res, url)
        return true
      }
      const handler = RPC_HANDLERS[name]
      if (req.method !== 'POST' || !handler) {
        sendJson(res, 404, { error: `no such RPC: ${name}` })
        return true
      }
      const raw = await readBody(req)
      const args: unknown[] = raw ? (JSON.parse(raw) as unknown[]) : []
      if (!Array.isArray(args)) {
        sendJson(res, 400, { error: 'the request body must be a JSON array of arguments' })
        return true
      }
      sendJson(res, 200, { ret: await handler(...(args as never[])) })
    } catch (err) {
      // An RPC that throws is a failed call, not a dead daemon: answer it and stay up. Without
      // this a rejected promise inside the mount became an unhandled rejection.
      if (!res.headersSent) sendJson(res, 500, { error: errorMessage(err) })
      else res.end()
    }
    return true
  }
}

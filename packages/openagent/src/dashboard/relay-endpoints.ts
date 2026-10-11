import type { IncomingMessage, ServerResponse } from 'node:http'
import type { OpenAgentEvent } from '../events.js'
import type { StartAgentOptions, StartAgentResult } from './types.js'
import type { RelayStartResult } from './remote-run.js'
import { end, readJsonBody, requireGet, sendJson } from './http.js'
import { passToScreen, screenCallOf, type ScreenCall } from './screen.js'
import { isRunId } from '../store/index.js'
import { openagentVersion } from '../version.js'

/**
 * The machine-side of the remote-agent relay (#1067): the endpoints through which another
 * machine's daemon runs a session here and watches it. They live under `/_relay`. This daemon
 * listens on its own computer only: a call from another machine reaches them through whatever
 * this computer opened to the network, which lets in only a machine that holds a key of its own
 * and passes its call on as this computer's own would arrive.
 *
 * - `POST /_relay/start`  starts an ordinary local agent and returns its {@link StartAgentResult}.
 * - `GET  /_relay/events?run=<id>&project=<address>` streams that agent's events as
 *   newline-delimited JSON until it ends or the caller disconnects.
 * - `GET  /_relay/ping` (#1072) a reachability probe: 200 and this OpenAgent's version, starts nothing. The
 *   online/offline status the dashboard shows is the local daemon calling this on each saved
 *   machine with its key there.
 * - `POST /_relay/rpc` (#1067 slice 2) runs one whitelisted run-scoped RPC (a read/diff/steer/handoff/
 *   push/PR) against this machine's own checkout for the daemon relaying an agent here, answering {result}.
 * - `GET /_relay/screen/stream?run=<id>&project=<address>` and `POST /_relay/screen/input?…` pass
 *   one call on to the live screen of a run here (screen.ts), for the daemon whose person watches it.
 *
 * All but the ping name their project by its repository's address, and work in this machine's own
 * project cloned from it. A call that names none, or one this machine does not have, starts and
 * reads nothing: there is no project a call falls back to.
 */
export const RELAY_PREFIX = '/_relay'

/** What the daemon wires behind the relay endpoints: its own start closure and an events tail. */
export interface RelayHandlers {
  /** This machine's own id for its project cloned from `address`, or undefined when it has none. */
  project: (address: string) => Promise<string | undefined>
  start: (prompt: string, options: StartAgentOptions, projectId: string) => StartAgentResult | Promise<StartAgentResult>
  tailEvents: (projectId: string, agentId: string, onEvent: (event: OpenAgentEvent) => void) => () => void
  /** Run one whitelisted read/steer/handoff RPC against THIS machine's own checkout, for the daemon
   *  relaying an agent here (#1067 slice 2); the caller wraps the result as {result}. */
  rpc?: (projectId: string, fn: string, args: unknown[]) => Promise<unknown>
  /** Where the live screen of a run here answers; nothing when the run has none. */
  screen?: (projectId: string, agentId: string) => Promise<string | undefined>
}

/** The body `POST /_relay/start` accepts: what a local Start needs, and the project's address. */
interface RelayStartBody {
  prompt?: unknown
  options?: unknown
  project?: unknown
}

/** This machine's id for the project a call names, or undefined: no address, or no such project here. */
async function projectNamed(handlers: RelayHandlers, address: unknown): Promise<string | undefined> {
  return typeof address === 'string' && address ? handlers.project(address) : undefined
}

const MAX_START_BODY = 256 * 1024

/** Route a `/_relay/*` request. A host that wired no relay handlers 404s every relay route. */
export async function handleRelayRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  handlers: RelayHandlers | undefined,
): Promise<void> {
  // Ping is a pure reachability probe (#1072): it needs no wired handlers and starts nothing,
  // so it answers even on a host that enabled no relay.
  if (pathname === `${RELAY_PREFIX}/ping`) return handlePing(req, res)
  if (!handlers) return end(res, 404, 'relay not enabled')
  if (pathname === `${RELAY_PREFIX}/start`) return handleStart(req, res, handlers)
  if (pathname === `${RELAY_PREFIX}/events`) return handleEvents(req, res, handlers)
  if (pathname === `${RELAY_PREFIX}/rpc`) return handleRpc(req, res, handlers)
  const screenCall = screenCallOf(pathname, `${RELAY_PREFIX}/screen`)
  if (screenCall) return handleScreen(req, res, handlers, screenCall)
  end(res, 404, 'not found')
}

/** `/_relay/screen/<call>?run=<id>&project=<address>`: pass the call on to the run's live screen here. */
async function handleScreen(req: IncomingMessage, res: ServerResponse, handlers: RelayHandlers, call: ScreenCall): Promise<void> {
  if (!handlers.screen) return end(res, 404, 'relay screen not enabled')
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams
  const agentId = query.get('run')
  if (!agentId || !isRunId(agentId)) return end(res, 400, 'missing run id')
  const projectId = await projectNamed(handlers, query.get('project')).catch(() => undefined)
  if (projectId === undefined) return end(res, 404, 'no such project on this machine')
  await passToScreen(req, res, call, await handlers.screen(projectId, agentId).catch(() => undefined))
}

/** `GET /_relay/ping` (#1072): answer 200 with this OpenAgent's version. Starts nothing; it proves this
 * daemon is reachable, and to another machine that its key still lets it in, and tells that
 * machine whether this one fell behind it. */
function handlePing(req: IncomingMessage, res: ServerResponse): void {
  if (!requireGet(req, res)) return
  sendJson(res, { version: openagentVersion() })
}

/** `POST /_relay/start`: read the agent request, start it locally, and answer with the result JSON. */
async function handleStart(req: IncomingMessage, res: ServerResponse, handlers: RelayHandlers): Promise<void> {
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  let body: RelayStartBody
  try {
    body = (await readJsonBody(req, MAX_START_BODY)) as RelayStartBody
  } catch {
    return end(res, 400, 'invalid request body')
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const options = (body.options && typeof body.options === 'object' ? body.options : {}) as StartAgentOptions
  // Never relay onward from a relayed agent: strip any nested target before starting it here.
  // And a start relayed to a machine never names a branch: the caller's branches are not this machine's.
  const { machine: _drop, base: _callers, ...local } = options
  let result: RelayStartResult
  try {
    const projectId = await projectNamed(handlers, body.project)
    result =
      projectId === undefined
        ? { ok: false, error: `no project on this machine is cloned from ${String(body.project)}`, noProject: true }
        : await handlers.start(prompt, local, projectId)
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  sendJson(res, result)
}

/** `GET /_relay/events?run=<id>&project=<address>`: stream the agent's events as newline-delimited JSON. */
async function handleEvents(req: IncomingMessage, res: ServerResponse, handlers: RelayHandlers): Promise<void> {
  if (!requireGet(req, res)) return
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams
  const agentId = query.get('run')
  if (!agentId) return end(res, 400, 'missing run id')
  const projectId = await projectNamed(handlers, query.get('project')).catch(() => undefined)
  if (projectId === undefined) return end(res, 404, 'no such project on this machine')
  // The caller went away while the project was looked up: a tail started now would never be stopped.
  if (res.destroyed || req.socket.destroyed) return
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' })
  const stop = handlers.tailEvents(projectId, agentId, event => {
    // A dropped write (the caller went away mid-line) must not throw out of the tail callback.
    try {
      res.write(`${JSON.stringify(event)}\n`)
    } catch {
      // the socket is gone; the close handler below tears the tail down
    }
  })
  const close = (): void => stop()
  res.on('close', close)
  req.on('close', close)
}

const MAX_RPC_BODY = 256 * 1024
/** POST /_relay/rpc: run one whitelisted RPC on this machine and answer {result}. */
async function handleRpc(req: IncomingMessage, res: ServerResponse, handlers: RelayHandlers): Promise<void> {
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  if (!handlers.rpc) return end(res, 404, 'relay rpc not enabled')
  let body: { fn?: unknown; args?: unknown; project?: unknown }
  try {
    body = (await readJsonBody(req, MAX_RPC_BODY)) as { fn?: unknown; args?: unknown; project?: unknown }
  } catch {
    return end(res, 400, 'invalid request body')
  }
  const fn = typeof body.fn === 'string' ? body.fn : ''
  const args = Array.isArray(body.args) ? body.args : []
  if (!fn) return end(res, 400, 'missing rpc name')
  try {
    const projectId = await projectNamed(handlers, body.project)
    if (projectId === undefined) return end(res, 404, 'no such project on this machine')
    sendJson(res, { result: await handlers.rpc(projectId, fn, args) })
  } catch (err) {
    end(res, 500, err instanceof Error ? err.message : 'rpc failed')
  }
}


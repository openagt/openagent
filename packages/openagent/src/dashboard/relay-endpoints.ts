import { computerHealth } from '../health.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { hostname } from 'node:os'
import type { OpenAgentEvent } from '../events.js'
import type { StartAgentOptions, StartAgentResult } from './types.js'
import { THROUGH_PATH, deviceIdOf, type BringProject, type RelayProject, type RelayStartResult } from './remote-run.js'
import { listMachines } from '../registry.js'
import { isLoginWord, isServerName, type GivenLogins, type MachineLogins } from './machine-logins.js'
import { end, readJsonBody, requireGet, sendJson } from './http.js'
import { passToScreen, screenCallOf, type ScreenCall } from './screen.js'
import { isRunId } from '../store/index.js'
import { openagentVersion } from '../version.js'
import { isRelayRead } from '../dashboard-rpc/relay-dispatch.js'

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
 * - `GET  /_relay/ping` (#1072) a reachability probe: 200, this OpenAgent's version, and the ids it is
 *   listed under at the doors of the machines it saved; starts nothing. The
 *   online/offline status the dashboard shows is the local daemon calling this on each saved
 *   machine with its key there.
 * - `POST /_relay/rpc` (#1067 slice 2) runs one whitelisted run-scoped RPC (a read/diff/steer/handoff/
 *   push/PR) against this machine's own checkout for the daemon relaying an agent here, answering {result}.
 * - `GET /_relay/project?project=<address>` says where this machine's copy of a project stands, and
 *   `POST /_relay/project` has this machine clone the project when it has none: the answer comes at
 *   once and the clone goes on by itself, so the caller asks again until the project is there.
 * - `GET /_relay/screen/stream?run=<id>&project=<address>` and `POST /_relay/screen/input?…` pass
 *   one call on to the live screen of a run here (screen.ts), for the daemon whose person watches it.
 * - `GET /_relay/logins` says which logins this OpenAgent's person has here, and `POST /_relay/logins`
 *   `{github?, claude?, from?}` hands them over (machine-logins.ts). Only an OpenAgent that is one
 *   person's, on another person's computer, answers it.
 *
 * All but the ping name their project by its repository's address, and work in this machine's own
 * project cloned from it. A call that names none, or one this machine does not have, starts and
 * reads nothing: there is no project a call falls back to. Only the call that asks for a project
 * brings one here.
 */
export const RELAY_PREFIX = '/_relay'

/**
 * The header of a call that may only watch. A computer that keeps a line open to its server
 * passes each call that comes down the line on to its own OpenAgent, and adds this header while
 * its person lets the server watch and no more. Such a call is answered when it only reads: the
 * ping, a run's events, where a project stands, a run's screen, a relayed function that is a
 * read. One that acts is refused with {@link WATCH_ONLY}: a start, a clone, a click or a key on
 * a run's screen, any other relayed function. The header only restricts, whatever its value: a
 * call without it is answered in full.
 */
export const WATCH_HEADER = 'x-openagent-watch'

/** What a call that acts is refused with (403) on a computer that only lets its server watch: read by the person, on the page the call was made from. */
export const WATCH_ONLY = 'This computer only lets its server watch. Turn on "From anywhere" through this server in its Settings, under Devices.'

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
  /** Where this machine's copy of the project at `address` stands; with `bring`, clone and add it when there is none. */
  bring?: (address: string, bring?: BringProject) => Promise<RelayProject>
  /** The logins of this OpenAgent's person here, and handing them over: only on an OpenAgent that is one person's. */
  logins?: {
    read: () => Promise<MachineLogins>
    give: (given: GivenLogins) => Promise<{ ok: true; logins: MachineLogins } | { ok: false; error: string }>
  }
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
  // A call that may only watch: a GET reads, and is answered. Anything else acts and is refused,
  // but for a relayed function, whose name says whether it reads (handleRpc).
  const watch = req.headers[WATCH_HEADER] !== undefined
  if (watch && req.method !== 'GET' && pathname !== `${RELAY_PREFIX}/rpc`) return end(res, 403, WATCH_ONLY)
  // Ping is a pure reachability probe (#1072): it needs no wired handlers and starts nothing,
  // so it answers even on a host that enabled no relay.
  if (pathname === `${RELAY_PREFIX}/ping`) return void handlePing(req, res)
  if (!handlers) return end(res, 404, 'relay not enabled')
  if (pathname === `${RELAY_PREFIX}/start`) return handleStart(req, res, handlers)
  if (pathname === `${RELAY_PREFIX}/events`) return handleEvents(req, res, handlers)
  if (pathname === `${RELAY_PREFIX}/rpc`) return handleRpc(req, res, handlers, watch)
  if (pathname === `${RELAY_PREFIX}/project`) return handleProject(req, res, handlers)
  if (pathname === `${RELAY_PREFIX}/logins`) return handleLogins(req, res, handlers)
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

/** `GET /_relay/ping` (#1072): answer 200 with this OpenAgent's version, this computer's own name, whether it is a server, and how it stands (its memory, disk and load). Starts
 * nothing; it proves this daemon is reachable, and to another machine that its key still lets it in, tells that
 * machine whether this one fell behind it, and which runs in a project's shared records are this computer's:
 * a run's record carries the name of the computer that ran it. */
async function handlePing(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireGet(req, res)) return
  // The ids this OpenAgent is listed under at the doors of the machines it saved: a computer that
  // saved this one, and that this one saved too, finds this one among its own door's devices by them.
  const listed = (await listMachines().catch(() => []))
    .filter(machine => !machine.url.includes(THROUGH_PATH))
    .flatMap(machine => deviceIdOf(machine.key) ?? [])
  // A server says so: a computer of its person's offers it its logins (`logins-sync.ts`).
  const health = await computerHealth().catch(() => undefined)
  sendJson(res, { version: openagentVersion(), host: hostname(), listed, ...(process.env.OPENAGENT_SERVER === '1' ? { server: true } : {}), ...(health ? { health } : {}) })
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

const MAX_PROJECT_BODY = 4 * 1024
/** How long a repository's address may be. */
const MAX_ADDRESS = 512

/**
 * `GET /_relay/project?project=<address>` and `POST /_relay/project` `{project, share, from}`: where this
 * machine's copy of the project stands. The POST also starts cloning it when there is none:
 * `share` is the caller's answer on the agents' records, which the copy here takes, and `from`
 * the address in the letters the caller's copy was cloned with.
 */
async function handleProject(req: IncomingMessage, res: ServerResponse, handlers: RelayHandlers): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'GET, POST' })
  if (!handlers.bring) return end(res, 404, 'relay project not enabled')
  let address: unknown
  let bring: BringProject | undefined
  if (req.method === 'POST') {
    let body: { project?: unknown; share?: unknown; from?: unknown } | null
    try {
      body = (await readJsonBody(req, MAX_PROJECT_BODY)) as typeof body
    } catch {
      return end(res, 400, 'invalid request body')
    }
    address = body?.project
    bring = { share: body?.share === true, ...(typeof body?.from === 'string' && body.from.length <= MAX_ADDRESS ? { from: body.from } : {}) }
  } else {
    address = new URL(req.url ?? '/', 'http://localhost').searchParams.get('project')
  }
  if (typeof address !== 'string' || !address || address.length > MAX_ADDRESS) return end(res, 400, 'missing project')
  let said: RelayProject
  try {
    said = await handlers.bring(address, bring)
  } catch (err) {
    said = { state: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
  sendJson(res, said)
}

const MAX_LOGINS_BODY = 16 * 1024

/**
 * `GET /_relay/logins` and `POST /_relay/logins` `{github?, claude?, from?}`: the logins of this
 * OpenAgent's person here, and logins handed over to it. A login with `from` is a copy from that
 * server; one without is the person's own, made for here. Each is a word and nothing else.
 */
async function handleLogins(req: IncomingMessage, res: ServerResponse, handlers: RelayHandlers): Promise<void> {
  if (!handlers.logins) return end(res, 404, 'this OpenAgent is no person\'s on another person\'s computer')
  if (req.method === 'GET') return sendJson(res, await handlers.logins.read())
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'GET, POST' })
  let body: { github?: unknown; claude?: unknown; from?: unknown } | null
  try {
    body = (await readJsonBody(req, MAX_LOGINS_BODY)) as typeof body
  } catch {
    return end(res, 400, 'invalid request body')
  }
  const { github, claude, from } = body ?? {}
  if ((github !== undefined && !isLoginWord(github)) || (claude !== undefined && !isLoginWord(claude)) || (from !== undefined && !isServerName(from))) return end(res, 400, 'that is no login')
  if (github === undefined && claude === undefined) return end(res, 400, 'no login was handed over')
  const given = await handlers.logins.give({ ...(github !== undefined ? { github } : {}), ...(claude !== undefined ? { claude } : {}), ...(from !== undefined ? { from } : {}) })
  if (!given.ok) return end(res, 422, given.error)
  sendJson(res, given.logins)
}

const MAX_RPC_BODY = 256 * 1024
/** POST /_relay/rpc: run one whitelisted RPC on this machine and answer {result}. A call that may only `watch` runs a read and no other. */
async function handleRpc(req: IncomingMessage, res: ServerResponse, handlers: RelayHandlers, watch: boolean): Promise<void> {
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
  if (watch && !isRelayRead(fn)) return end(res, 403, WATCH_ONLY)
  try {
    const projectId = await projectNamed(handlers, body.project)
    if (projectId === undefined) return end(res, 404, 'no such project on this machine')
    sendJson(res, { result: await handlers.rpc(projectId, fn, args) })
  } catch (err) {
    end(res, 500, err instanceof Error ? err.message : 'rpc failed')
  }
}


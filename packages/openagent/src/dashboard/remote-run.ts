import { EventStream } from '../event-stream.js'
import type { OpenAgentEvent } from '../events.js'
import type { AgentMeta } from '../store/index.js'
import type { StartAgentOptions, StartAgentResult } from './types.js'
import { errorMessage } from '../error-message.js'
import { machineFetch } from './machine-call.js'
import { isHostName } from '../registry.js'

/**
 * The server-side half of "run on a saved machine" (#1067). The local daemon holds this computer's
 * key on the saved machine, so it - not the browser - drives the remote daemon: it POSTs the agent to the
 * remote's `/_relay/start` and then fetch-streams the remote's `/_relay/events` back into a local
 * {@link EventStream}, which the dashboard reads over its normal same-origin `onEvents` channel. So
 * the browser never talks cross-origin and the key never leaves the two daemons (issue #1067 (b)).
 *
 * Every call but the ping names its project, by its repository's address
 * (repository-address.ts): a project's folder, and so its id, is another one on each machine.
 *
 * The other OpenAgent listens on its own computer only. What answers at a machine's address is
 * whatever that computer opened to the network, which lets this computer in once, with the code
 * a machine's link carries ({@link enterRemote}), answers a key of this computer's own, and from
 * then on passes each call that carries the key (`Authorization: Bearer`, no `Origin`) to its
 * OpenAgent as that computer's own browser would have made it.
 */

/** How a machine is reached: where its OpenAgent answers, this computer's key there, and what the machine's own key is known by when its link said. */
export interface MachineAccess {
  url: string
  key: string
  pin?: string
}

/** Where a relayed agent works: a machine, and the project there, by its repository's address. */
export interface RemoteTarget extends MachineAccess {
  project: string
}

/** What a relay start forwards to the remote's `/_relay/start`, beside the project. */
export interface RelayStartBody {
  prompt: string
  options: StartAgentOptions
}

/**
 * What a machine answers a relayed start with: a Start's own outcome, or `noProject` when it has
 * no project cloned from the address the start named.
 */
export type RelayStartResult = StartAgentResult | { ok: false; error: string; noProject: true }

const START_TIMEOUT_MS = 15_000

/** How long a status ping waits before calling a machine offline (#1072): short, since it polls. */
const PING_TIMEOUT_MS = 3_000

/** One `GET /_relay/ping` with this computer's key: the answer when it is a 2xx, else nothing (the key no longer lets in, the host is unreachable, the time is up). */
async function ping(target: MachineAccess): Promise<Response | undefined> {
  try {
    const res = await machineFetch(`${trimSlashes(target.url)}/_relay/ping`, target.pin, {
      headers: { authorization: `Bearer ${target.key}` },
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    return res.ok ? res : undefined
  } catch {
    return undefined
  }
}

/**
 * Health-check a saved machine (#1072): true when it answers this computer's key. This is how
 * the browser's status dots learn reachable from not.
 */
export async function pingRemote(target: MachineAccess): Promise<boolean> {
  return (await ping(target)) !== undefined
}

/**
 * What a saved machine says of itself in its ping: the OpenAgent it runs, and the computer's own
 * name, which the records of its runs carry. Nothing for a machine that does not answer, or
 * does not say.
 */
export async function remoteFacts(target: MachineAccess): Promise<{ version?: string; host?: string }> {
  const said: unknown = await (await ping(target))?.json().catch(() => undefined)
  const { version, host } = (said && typeof said === 'object' ? said : {}) as Record<string, unknown>
  return {
    // What a machine says is shown on a page: only what reads as a version is one.
    ...(typeof version === 'string' && /^[0-9A-Za-z.+-]{1,64}$/.test(version) ? { version } : {}),
    ...(isHostName(host) ? { host } : {}),
  }
}

/** The OpenAgent a saved machine runs, as its ping tells it; nothing for a machine that does not answer, or does not say. */
export async function remoteVersion(target: MachineAccess): Promise<string | undefined> {
  return (await remoteFacts(target)).version
}

/** The two headers every relay request carries: JSON, and this computer's key there. No Origin on purpose. */
function relayHeaders(key: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${key}` }
}

/** What a machine says when this computer's key no longer lets it in: it was removed there. */
const NOT_IN = 'this computer is no longer in on the machine: add the machine again, with a new link'

/** How much of a machine's own words about a failure is shown. */
const MAX_SAID = 600

/**
 * Why a machine refused a call, in its own words: a 403 carries them, written for the person to
 * read on the page the call was made from (a computer that only lets its server watch says so,
 * and where that is changed). Nothing for any other answer, and for a 403 that gives no reason.
 */
async function refusalOf(res: Response): Promise<string | undefined> {
  if (res.status !== 403) return undefined
  return (await res.text().catch(() => '')).trim().slice(0, MAX_SAID) || undefined
}

/** A machine refused a call and said why: the message is the machine's own words, for the person to read. */
export class MachineRefusal extends Error {}

const ENTER_TIMEOUT_MS = 10_000
/** How long a machine gets to take this computer out: it is not waited for by a person. */
const LEAVE_TIMEOUT_MS = 5_000
/** What a machine answers to a code that was used before or is too old. */
const CODE_SPENT = 'this code no longer works'

/** What asking to be let in came to: this computer's key there, or why not, in words. */
export type EnterResult = { ok: true; key: string } | { ok: false; error: string }

/**
 * Ask a machine to let this computer in, with the code its link carries, under `name`. The code
 * is good once: a link used before, or older than a few minutes, is refused.
 */
export async function enterRemote(door: string, code: string, name: string, pin?: string): Promise<EnterResult> {
  let res: Response
  try {
    res = await machineFetch(door, pin, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, computer: name }),
      signal: AbortSignal.timeout(ENTER_TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, error: `The machine did not answer: ${errorMessage(err)}` }
  }
  if (res.status === 403) {
    // The machine says why in words: a link that was used is one reason among others (this
    // computer is on another network than the machine, the machine's list is full).
    const why = (await res.text().catch(() => '')).trim().slice(0, 200)
    if (why === CODE_SPENT) return { ok: false, error: 'This link no longer works. A link works once, and for a short time: make a new one on the other machine.' }
    return { ok: false, error: why ? `The machine refused: ${why}.` : 'The machine refused.' }
  }
  if (!res.ok) return { ok: false, error: `The machine refused (${res.status}).` }
  const key = await res.json().then(body => (body as { key?: unknown } | null)?.key, () => undefined)
  return typeof key === 'string' && key ? { ok: true, key } : { ok: false, error: 'What answered at this link is not an OpenAgent that lets a machine in.' }
}

/**
 * The id a machine lists this computer under, among the devices that are in there: a door hands
 * out a key as that id, a dot, and the secret. Never the secret; `undefined` for a key of
 * another shape, so nothing of one is ever taken for an id.
 */
export function deviceIdOf(key: string): string | undefined {
  const id = key.slice(0, Math.max(0, key.indexOf('.')))
  return /^[a-z0-9]{6,32}$/.test(id) ? id : undefined
}

/**
 * Take this computer out of a machine: its key there stops working. Whether the machine did;
 * one that cannot be reached keeps the key until this computer is removed there by hand.
 */
export async function leaveRemote(machine: MachineAccess & { door: string }): Promise<boolean> {
  try {
    const res = await machineFetch(machine.door, machine.pin, { method: 'DELETE', headers: { authorization: `Bearer ${machine.key}` }, signal: AbortSignal.timeout(LEAVE_TIMEOUT_MS) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Start an agent on the remote daemon, in its project cloned from `target.project`, and return
 * what it answered (with the remote's own run id). A non-2xx or a transport failure surfaces as an
 * `ok: false` result the dashboard shows, the same shape a local refusal has, so the caller does
 * not special-case remote errors.
 */
export async function startRemoteAgent(target: RemoteTarget, body: RelayStartBody): Promise<RelayStartResult> {
  try {
    const res = await machineFetch(`${trimSlashes(target.url)}/_relay/start`, target.pin, {
      method: 'POST',
      headers: relayHeaders(target.key),
      body: JSON.stringify({ ...body, project: target.project }),
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    })
    if (res.status === 401) return { ok: false, error: NOT_IN }
    if (!res.ok) return { ok: false, error: (await refusalOf(res)) ?? `the machine refused the run (${res.status})` }
    return (await res.json()) as RelayStartResult
  } catch (err) {
    return { ok: false, error: `could not reach the machine: ${errorMessage(err)}` }
  }
}

/**
 * Where a project a machine was asked for stands there: `there` once it is among its projects,
 * `coming` while the machine clones it, `failed` with the machine's words when the clone or the
 * add did not go through, and `missing` when the machine has no such project and is not at work
 * on one.
 */
export type RelayProject = { state: 'there' | 'coming' | 'missing' } | { state: 'failed'; error: string }

const PROJECT_TIMEOUT_MS = 15_000

/**
 * Ask a machine about its copy of the project `target` names, and with `bring` have it clone the
 * project when it has none: the machine answers at once and clones on its own, so this is asked
 * again until it says `there`. `share` is this computer's own answer on the agents' records for
 * the project, which the machine's copy takes, and `from` the address in the letters this
 * computer's copy was cloned with. A machine that could not be asked is `unasked`, in this
 * computer's words; `failed` carries the machine's own.
 */
export async function remoteProject(target: RemoteTarget, bring?: BringProject): Promise<RelayProject | { state: 'unasked'; error: string }> {
  try {
    const url = `${trimSlashes(target.url)}/_relay/project`
    const res = bring
      ? await machineFetch(url, target.pin, { method: 'POST', headers: relayHeaders(target.key), body: JSON.stringify({ project: target.project, ...bring }), signal: AbortSignal.timeout(PROJECT_TIMEOUT_MS) })
      : await machineFetch(`${url}?project=${encodeURIComponent(target.project)}`, target.pin, { headers: relayHeaders(target.key), signal: AbortSignal.timeout(PROJECT_TIMEOUT_MS) })
    if (res.status === 401) return { state: 'unasked', error: NOT_IN }
    // An OpenAgent from before a machine cloned a project by itself has no such call.
    if (res.status === 404) return { state: 'unasked', error: 'it runs an older OpenAgent, which cannot clone a project by itself. Update it, or add the project there.' }
    if (!res.ok) return { state: 'unasked', error: (await refusalOf(res)) ?? `the machine refused (${res.status})` }
    const said = (await res.json()) as { state?: unknown; error?: unknown }
    if (said.state === 'there' || said.state === 'coming' || said.state === 'missing') return { state: said.state }
    return { state: 'failed', error: typeof said.error === 'string' && said.error ? said.error.slice(0, MAX_SAID) : 'the machine did not say why' }
  } catch (err) {
    return { state: 'unasked', error: `could not reach the machine: ${errorMessage(err)}` }
  }
}

/** What a machine is given to clone a project it does not have. */
export interface BringProject {
  /** This computer's answer on the agents' records for the project: whether they may go to the repository's remote. */
  share: boolean
  /** The address in the letters this computer's copy was cloned with; the machine clones from it when it reads as the project's. */
  from?: string
}

const RPC_TIMEOUT_MS = 60_000 // a relayed git push/PR runs over the network on the machine

/**
 * Relay one run-scoped RPC to the machine that owns a remote agent (#1067 slice 2). The local daemon
 * holds this computer's key there, so a read/diff/handoff/push/PR for a relayed agent runs ON the machine: POST
 * {fn, args} to the remote's /_relay/rpc with the key (no Origin), returning the machine's
 * result. Throws on an unreachable machine or a non-2xx so the caller falls back to its own empty/error
 * shape, the same way a failed local read does. A refusal the machine gave a reason for is thrown
 * as a {@link MachineRefusal}, so the reason can be shown in place of that shape's own words.
 */
export async function relayRpc(target: RemoteTarget, fn: string, args: unknown[]): Promise<unknown> {
  const res = await machineFetch(`${trimSlashes(target.url)}/_relay/rpc`, target.pin, {
    method: 'POST',
    headers: relayHeaders(target.key),
    body: JSON.stringify({ fn, args, project: target.project }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  })
  if (!res.ok) {
    const why = await refusalOf(res)
    throw why === undefined ? new Error(`the machine refused the request (${res.status})`) : new MachineRefusal(why)
  }
  const body = (await res.json()) as { result?: unknown }
  return body.result
}

/**
 * Fetch-stream a remote agent's newline-delimited events into `onEvent` until the remote closes the
 * body, the agent ends, or `cancel()` is called. A 401 (this computer was removed there) ends the stream
 * cleanly rather than as an error, so the dashboard sees a normal `done`, not a lost connection.
 * Returns a cancel function; calling it aborts the fetch and releases the reader.
 */
export function streamRemoteEvents(
  target: RemoteTarget,
  agentId: string,
  onEvent: (event: OpenAgentEvent) => void,
  onEnd?: () => void,
): () => void {
  const controller = new AbortController()
  let ended = false
  const end = (): void => {
    if (ended) return
    ended = true
    onEnd?.()
  }
  void (async () => {
    try {
      const url = `${trimSlashes(target.url)}/_relay/events?run=${encodeURIComponent(agentId)}&project=${encodeURIComponent(target.project)}`
      const res = await machineFetch(url, target.pin, { headers: relayHeaders(target.key), signal: controller.signal })
      // 401 = this computer was removed on the machine. Nothing more will stream; end cleanly (a done, not a loss).
      if (!res.ok || !res.body) return end()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Emit every complete line, keeping the trailing partial for the next chunk.
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          emitLine(buffer.slice(0, newline), onEvent)
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
        }
      }
      emitLine(buffer, onEvent) // a final line with no trailing newline
    } catch {
      // Aborted by cancel(), or the transport dropped: either way the stream is over.
    } finally {
      end()
    }
  })()
  return () => {
    controller.abort()
    end()
  }
}

/** Parse one NDJSON line as a {@link OpenAgentEvent} and forward it; a blank or malformed line is skipped. */
function emitLine(line: string, onEvent: (event: OpenAgentEvent) => void): void {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    onEvent(JSON.parse(trimmed) as OpenAgentEvent)
  } catch {
    // A partial or malformed line is dropped rather than crashing the pump.
  }
}

interface RelayedAgent {
  target: RemoteTarget
  stream: EventStream<OpenAgentEvent>
  cancel: () => void
}

/** How many runs are followed by their record at once: each holds a line to its machine open. */
const MAX_FOLLOWED = 20

/**
 * The local daemon's live relayed runs (#1067), keyed by the remote agent id. Registering an agent opens
 * an {@link EventStream} the dashboard reads through `onEvents`, fed by {@link streamRemoteEvents}
 * from the remote. The target is the saved machine as it was at the Start. A machine is not
 * removed while a run is at work on it ({@link working}); the runs that ended there before it
 * was removed read as unreachable, and one added again answers for them with its new key ({@link rekey}).
 *
 * The `targets` map outlives the event pump (#1067 slice 2): a finished remote agent's post-run reads,
 * open-PR and merge still have to reach the machine after its event stream has ended, so the machine
 * target is kept until {@link dispose} clears it, not dropped when the stream closes.
 *
 * The `metas` map (#1077) holds a local {@link AgentMeta} stub per relayed agent so `onAgents` can show a
 * remote run in the session list and re-open it after a dashboard reload; {@link list} projects it
 * per project. Same lifetime as `targets`: it outlives the event stream and is cleared on dispose.
 */
export class RelayedAgents {
  private readonly agents = new Map<string, RelayedAgent>()
  private readonly targets = new Map<string, RemoteTarget>()
  // The local AgentMeta stub for each relayed agent, so onAgents can show a remote agent in the session list
  // and re-open it after a reload; outlives the event stream, cleared on dispose (same lifetime as targets).
  private readonly metas = new Map<string, { meta: AgentMeta; projectId: string }>()
  // The runs followed by their record, oldest first: started on the machine, not sent from here.
  private readonly followed: string[] = []

  /**
   * Open a local stream for a remote agent and start pumping the remote's events into it. `sent`
   * is a run this computer started there. Any other is followed by its record, which someone
   * else may have written: it never stands for a run that is at work ({@link working}), and only
   * so many are followed at once.
   */
  register(agentId: string, target: RemoteTarget, meta: AgentMeta, projectId: string, sent = true): void {
    // A run this computer sent stays one it sent, also when it is followed again by its record.
    if (this.isSent(agentId)) sent = true
    // A re-register (same id) replaces the old pump. Hung up first: its end is the old row's, not the new one's.
    this.agents.get(agentId)?.cancel()
    const at = this.followed.indexOf(agentId)
    if (at !== -1) this.followed.splice(at, 1)
    if (!sent) {
      this.followed.push(agentId)
      // A machine's stream stays open until it is hung up here: the oldest make room, and are read by their records again.
      while (this.followed.length > MAX_FOLLOWED) this.forget(this.followed[0]!)
    }
    this.targets.set(agentId, target) // kept past the stream, for post-run reads/push/PR (slice 2)
    this.metas.set(agentId, { meta, projectId }) // the local list row, so a reload re-opens the run (#1077)
    const stream = new EventStream<OpenAgentEvent>()
    const cancel = streamRemoteEvents(target, agentId, event => {
      stream.push(event)
      this.apply(agentId, event) // fold the event into the run's list row, mirroring the machine
    }, () => this.endStream(agentId))
    this.agents.set(agentId, { target, stream, cancel })
  }

  /**
   * Whether the run is kept here as a run of that project. A run's id says nothing of its
   * project, and a run of one project is never taken for one of another by its id alone.
   */
  private of(agentId: string | undefined, projectId: string | undefined): agentId is string {
    return agentId !== undefined && (projectId === undefined || this.metas.get(agentId)?.projectId === projectId)
  }

  /** The live event stream for a relayed agent of the project, or undefined when this daemon is not relaying it. */
  get(agentId: string | undefined, projectId?: string): EventStream<OpenAgentEvent> | undefined {
    return this.of(agentId, projectId) ? this.agents.get(agentId)?.stream : undefined
  }

  /** The machine a relayed agent of the project runs on, kept past the event stream so post-run push/PR still reach it. */
  target(agentId: string | undefined, projectId?: string): RemoteTarget | undefined {
    return this.of(agentId, projectId) ? this.targets.get(agentId) : undefined
  }

  /** Whether this daemon follows the project's run now: its events stream. */
  follows(agentId: string, projectId?: string): boolean {
    return this.of(agentId, projectId) && this.agents.has(agentId)
  }

  /**
   * Whether a run this computer sent is still at work on the machine at `url`. A machine's
   * stream stays open after its run ended, for the next message to it, so the run's own state
   * says it and not the stream. A run followed by its record does not count: its state is what
   * a record said, and a machine is not held by a record anyone with the project can write.
   */
  working(url: string): boolean {
    for (const [agentId, agent] of this.agents) {
      if (agent.target.url === url && !this.followed.includes(agentId) && this.metas.get(agentId)?.meta.status === 'running') return true
    }
    return false
  }

  /** Whether the run is one this computer sent to its machine, not one followed by its record. */
  isSent(agentId: string): boolean {
    return this.metas.has(agentId) && !this.followed.includes(agentId)
  }

  /** Stop following a run and forget it: it is read by its record again. */
  private forget(agentId: string): void {
    const at = this.followed.indexOf(agentId)
    if (at !== -1) this.followed.splice(at, 1)
    const agent = this.agents.get(agentId)
    this.agents.delete(agentId)
    this.targets.delete(agentId)
    this.metas.delete(agentId)
    agent?.cancel()
    agent?.stream.close()
  }

  /** How the machine at `url` is reached since it was added again, for the runs kept from before: this computer's new key there, and the key the machine is known by. */
  rekey(url: string, key: string, pin?: string): void {
    // A run followed by its record is the machine's by the machine's own name, and a machine added again has not said its name yet.
    for (const agentId of [...this.followed]) if (this.targets.get(agentId)?.url === url) this.forget(agentId)
    for (const [agentId, target] of this.targets) {
      if (target.url === url) this.targets.set(agentId, { url, key, ...(pin ? { pin } : {}), project: target.project })
    }
  }

  /** A project's relayed run stubs (#1077), newest-first, so `onAgents` can surface them in the list. */
  list(projectId: string): AgentMeta[] {
    const rows: AgentMeta[] = []
    for (const entry of this.metas.values()) if (entry.projectId === projectId) rows.push(entry.meta)
    // Newest first: startedAt is ISO, so a string compare is the time order (no parse).
    return rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
  }

  /** Fold each relayed event into the agent's list row via the store's own reducer (#1077), so the
   *  local stub mirrors the machine: the terminal status on `end`, the waiting flag while it is parked
   *  (#785). Events carry no write time, so this stamps its own. */
  private apply(agentId: string, event: OpenAgentEvent): void {
    const entry = this.metas.get(agentId)
    if (!entry) return
    entry.meta = foldRelayedEvent(entry.meta, event, new Date().toISOString())
  }

  /** Close a relayed agent's event stream (not its target). Idempotent. */
  private endStream(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    // A run followed by its record has that record to say how it stands: a line that dropped says nothing of the run.
    if (this.followed.includes(agentId)) return this.forget(agentId)
    this.agents.delete(agentId)
    agent.stream.close() // a clean close surfaces as `done` in the browser, not a lost stream
    // The stream dropped with no terminal event: the agent is no longer live, so stop showing it as such.
    const entry = this.metas.get(agentId)
    if (entry && entry.meta.status === 'running') entry.meta.status = 'stopped'
  }

  /** Stop every pump, close every stream, and forget every machine target + list stub, on daemon shutdown. */
  dispose(): void {
    for (const [agentId, agent] of this.agents) {
      agent.cancel()
      agent.stream.close()
      this.agents.delete(agentId)
    }
    this.targets.clear()
    this.metas.clear()
    this.followed.length = 0
  }
}

/** Trim trailing slashes off a base URL so `${base}/_relay/...` never doubles them. */
function trimSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Fold one relayed event into the memory-only row of a run on a machine: what the machine's own
 * card would say, kept here because that card is on the machine. The events are the ones a run's
 * diary yields: the agent's session id, its cost, its end.
 */
export function foldRelayedEvent(meta: AgentMeta, event: OpenAgentEvent, at: string): AgentMeta {
  const next: AgentMeta = { ...meta, updatedAt: at }
  // A run that ended and was continued is at work again: its next leg starts as its first did.
  if (event.kind === 'driver' && event.event.type === 'start') {
    next.status = 'running'
    delete next.endedAt
  } else if (event.kind === 'session-update') next.sessionId = event.sessionId
  else if (event.kind === 'usage') next.cost = (next.cost ?? 0) + event.costUsd
  else if (event.kind === 'end') {
    next.status = event.ok ? 'done' : event.stopped ? 'stopped' : event.waiting ? 'waiting' : 'failed'
    next.endedAt = at
  }
  return next
}

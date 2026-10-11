import { EventStream } from '../event-stream.js'
import type { OpenAgentEvent } from '../events.js'
import type { AgentMeta } from '../store/index.js'
import type { StartAgentOptions, StartAgentResult } from './types.js'
import { errorMessage } from '../error-message.js'
import { machineFetch } from './machine-call.js'

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

/**
 * Health-check a saved machine (#1072): a `GET /_relay/ping` with this computer's key, true on
 * any 2xx, false on a non-2xx (the key no longer lets in), an unreachable host, or the timeout.
 * This is how the browser's status dots learn reachable from not.
 */
export async function pingRemote(target: MachineAccess): Promise<boolean> {
  try {
    const res = await machineFetch(`${trimSlashes(target.url)}/_relay/ping`, target.pin, {
      headers: { authorization: `Bearer ${target.key}` },
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/** The two headers every relay request carries: JSON, and this computer's key there. No Origin on purpose. */
function relayHeaders(key: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${key}` }
}

/** What a machine says when this computer's key no longer lets it in: it was removed there. */
const NOT_IN = 'this computer is no longer in on the machine: add the machine again, with a new link'

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
    if (!res.ok) return { ok: false, error: `the machine refused the run (${res.status})` }
    return (await res.json()) as RelayStartResult
  } catch (err) {
    return { ok: false, error: `could not reach the machine: ${errorMessage(err)}` }
  }
}

const RPC_TIMEOUT_MS = 60_000 // a relayed git push/PR runs over the network on the machine

/**
 * Relay one run-scoped RPC to the machine that owns a remote agent (#1067 slice 2). The local daemon
 * holds this computer's key there, so a read/diff/handoff/push/PR for a relayed agent runs ON the machine: POST
 * {fn, args} to the remote's /_relay/rpc with the key (no Origin), returning the machine's
 * result. Throws on an unreachable machine or a non-2xx so the caller falls back to its own empty/error
 * shape, the same way a failed local read does.
 */
export async function relayRpc(target: RemoteTarget, fn: string, args: unknown[]): Promise<unknown> {
  const res = await machineFetch(`${trimSlashes(target.url)}/_relay/rpc`, target.pin, {
    method: 'POST',
    headers: relayHeaders(target.key),
    body: JSON.stringify({ fn, args, project: target.project }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`the machine refused the request (${res.status})`)
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

  /** Open a local stream for a remote agent and start pumping the remote's events into it. */
  register(agentId: string, target: RemoteTarget, meta: AgentMeta, projectId: string): void {
    this.targets.set(agentId, target) // kept past the stream, for post-run reads/push/PR (slice 2)
    this.metas.set(agentId, { meta, projectId }) // the local list row, so a reload re-opens the run (#1077)
    this.agents.get(agentId)?.cancel() // a re-register (same id) replaces the old pump
    const stream = new EventStream<OpenAgentEvent>()
    const cancel = streamRemoteEvents(target, agentId, event => {
      stream.push(event)
      this.apply(agentId, event) // fold the event into the run's list row, mirroring the machine
    }, () => this.endStream(agentId))
    this.agents.set(agentId, { target, stream, cancel })
  }

  /** The live event stream for a relayed agent, or undefined when this daemon is not relaying it. */
  get(agentId: string | undefined): EventStream<OpenAgentEvent> | undefined {
    return agentId ? this.agents.get(agentId)?.stream : undefined
  }

  /** The machine a relayed agent runs on, kept past the event stream so post-run push/PR still reach it. */
  target(agentId: string | undefined): RemoteTarget | undefined {
    return agentId ? this.targets.get(agentId) : undefined
  }

  /** Whether a run this daemon follows is still at work on the machine at `url`: its events still stream. */
  working(url: string): boolean {
    for (const agent of this.agents.values()) if (agent.target.url === url) return true
    return false
  }

  /** How the machine at `url` is reached since it was added again, for the runs kept from before: this computer's new key there, and the key the machine is known by. */
  rekey(url: string, key: string, pin?: string): void {
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
   *  (#785), the driver once its session starts. Events carry no write time, so this stamps its own. */
  private apply(agentId: string, event: OpenAgentEvent): void {
    const entry = this.metas.get(agentId)
    if (!entry) return
    entry.meta = foldRelayedEvent(entry.meta, event, new Date().toISOString())
  }

  /** Close a relayed agent's event stream (not its target). Idempotent. */
  private endStream(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
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
  if (event.kind === 'session-update') next.sessionId = event.sessionId
  else if (event.kind === 'usage') next.cost = (next.cost ?? 0) + event.costUsd
  else if (event.kind === 'end') {
    next.status = event.ok ? 'done' : event.stopped ? 'stopped' : event.waiting ? 'waiting' : 'failed'
    next.endedAt = at
  }
  return next
}

import { EventStream } from '../event-stream.js'
import type { OpenAgentEvent } from '../events.js'
import type { AgentMeta } from '../store/index.js'
import type { StartAgentOptions, StartAgentResult } from './types.js'
import { errorMessage } from '../error-message.js'

/**
 * The server-side half of "run on a saved machine" (#1067). The local daemon holds the saved
 * machine's token, so it - not the browser - drives the remote daemon: it POSTs the agent to the
 * remote's `/_relay/start` and then fetch-streams the remote's `/_relay/events` back into a local
 * {@link EventStream}, which the dashboard reads over its normal same-origin `onEvents` channel. So
 * the browser never talks cross-origin and the token never leaves the two daemons (issue #1067 (b)).
 *
 * Every call but the ping names its project, by its repository's address
 * (repository-address.ts): a project's folder, and so its id, is another one on each machine.
 *
 * Authentication is the shared-token cookie (#1051), sent daemon-to-daemon: `Cookie: oa_daemon=<token>` with no
 * `Origin` header. The remote's guard admits a matching cookie without the browser-only `?token=`
 * 302, and its `/_rpc` CSRF check (absent Origin passes) is not even on these raw routes.
 */

/** How a machine is reached: its daemon's origin and its #1051 token. */
export interface MachineAccess {
  url: string
  token: string
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
 * Health-check a saved machine (#1072): a cookie'd `GET /_relay/ping`, true on any 2xx, false on a
 * non-2xx, an unreachable host, or the timeout. This is how the browser's status dots learn
 * reachable from not.
 */
export async function pingRemote(target: MachineAccess): Promise<boolean> {
  try {
    const res = await fetch(`${trimSlashes(target.url)}/_relay/ping`, {
      headers: { cookie: `oa_daemon=${target.token}` },
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/** The two headers every relay request carries: JSON, and the shared-token cookie (#1051). No Origin on purpose. */
function relayHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', cookie: `oa_daemon=${token}` }
}

/**
 * Start an agent on the remote daemon, in its project cloned from `target.project`, and return
 * what it answered (with the remote's own run id). A non-2xx or a transport failure surfaces as an
 * `ok: false` result the dashboard shows, the same shape a local refusal has, so the caller does
 * not special-case remote errors.
 */
export async function startRemoteAgent(target: RemoteTarget, body: RelayStartBody): Promise<RelayStartResult> {
  try {
    const res = await fetch(`${trimSlashes(target.url)}/_relay/start`, {
      method: 'POST',
      headers: relayHeaders(target.token),
      body: JSON.stringify({ ...body, project: target.project }),
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, error: `the machine refused the run (${res.status})` }
    return (await res.json()) as RelayStartResult
  } catch (err) {
    return { ok: false, error: `could not reach the machine: ${errorMessage(err)}` }
  }
}

const RPC_TIMEOUT_MS = 60_000 // a relayed git push/PR runs over the network on the machine

/**
 * Relay one run-scoped RPC to the machine that owns a remote agent (#1067 slice 2). The local daemon
 * holds the machine token, so a read/diff/handoff/push/PR for a relayed agent runs ON the machine: POST
 * {fn, args} to the remote's /_relay/rpc over the shared-token cookie (#1051) (no Origin), returning the machine's
 * result. Throws on an unreachable machine or a non-2xx so the caller falls back to its own empty/error
 * shape, the same way a failed local read does.
 */
export async function relayRpc(target: RemoteTarget, fn: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`${trimSlashes(target.url)}/_relay/rpc`, {
    method: 'POST',
    headers: relayHeaders(target.token),
    body: JSON.stringify({ fn, args, project: target.project }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`the machine refused the request (${res.status})`)
  const body = (await res.json()) as { result?: unknown }
  return body.result
}

/**
 * Fetch-stream a remote agent's newline-delimited events into `onEvent` until the remote closes the
 * body, the agent ends, or `cancel()` is called. A 401 (the token was rotated) ends the stream
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
      const res = await fetch(url, { headers: relayHeaders(target.token), signal: controller.signal })
      // 401 = the machine rotated its token. Nothing more will stream; end cleanly (a done, not a loss).
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
 * from the remote. The target is the saved machine as it was at the Start, so a machine removed
 * since still answers for the runs it has.
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

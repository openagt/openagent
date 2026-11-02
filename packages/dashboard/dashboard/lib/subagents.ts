import type { AgentDoing, AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { startedAtFromAgentId } from '../../src/agent-id.js'
import { agentLabel } from './agent-label.js'

// A run started for another run is that run's subagent: its card names the other run as its
// parent. Everything the dashboard shows about subagents (the rail's tree, the rows in the main
// agent's chat, the line above its message box) is read off that one field.

/** A run's subagents, in the order they were started: an id sorts by start time. */
export function subagentsOf(agents: readonly AgentMeta[], id: string): AgentMeta[] {
  return agents.filter(agent => agent.parent === id).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** What a subagent's row calls it: the first line of what it was asked. */
export function taskLabel(agent: Pick<AgentMeta, 'id' | 'intent' | 'branch' | 'startedAt'>): string {
  return agentLabel(agent).split('\n')[0]!.trim()
}

/** A subagent that is not over: working, or stopped on a question. */
export function isOpenSubagent(agent: Pick<AgentMeta, 'status'>): boolean {
  return agent.status === 'running' || agent.status === 'waiting'
}

/** How long after a subagent ended its main agent may still be on its way back to work. */
const CONTINUING_MS = 10_000

/**
 * A subagent its main agent's job is not over with: working, saving its record, or ended so
 * recently that the main agent is still being continued with its end. A main agent is continued
 * a few seconds after its subagent's card says it ended, and for that moment both read as ended.
 */
export function holdsMainAgent(agent: Pick<AgentMeta, 'status' | 'saving' | 'endedAt'>, now: number): boolean {
  if (agent.status === 'running' || agent.saving === true) return true
  return agent.endedAt !== undefined && now - Date.parse(agent.endedAt) < CONTINUING_MS
}

/** A row of a list of runs, as the tree needs it: a key that ends with the run's id, and the run. */
type TreeRow = { key: string; agent: AgentMeta }

/**
 * A list of runs as a tree one level deep: a run whose parent is in the list sits under it, in
 * the order the subagents were started, and every other run keeps its place. A run whose parent
 * is not in the list, or is itself under another run, stays a row of its own.
 */
export function nestRows<R extends TreeRow>(rows: readonly R[]): { row: R; subagents: R[] }[] {
  const byKey = new Map(rows.map(row => [row.key, row]))
  // The parent's key is the row's own with the parent's id in place of the run's: a list that
  // pools several projects prefixes each key with its project, and a parent is in the same one.
  const parentOf = (row: R): R | undefined =>
    row.agent.parent !== undefined ? byKey.get(row.key.slice(0, row.key.length - row.agent.id.length) + row.agent.parent) : undefined
  const under = (row: R): R | undefined => {
    const parent = parentOf(row)
    return parent && !parentOf(parent) ? parent : undefined
  }
  return rows
    .filter(row => !under(row))
    .map(row => ({
      row,
      subagents: rows.filter(other => under(other) === row).sort((a, b) => (a.agent.id < b.agent.id ? -1 : a.agent.id > b.agent.id ? 1 : 0)),
    }))
}

/** How a subagent ended, as the line its main agent was sent says it. */
export type SubagentEnd = { agent: AgentMeta; status: string; detail?: string; rest: string }

/** The line the tool that runs agents sends a run when a run started for it ends: its opening words. */
const ENDED = /^The run (\S+), started for this run, ended (\w+)(?:: (.*?))?\.?$/

/**
 * A prompt as the end of one of the run's subagents, or `undefined` when it is anything else: it
 * opens with the ended line and the run it names is one of these subagents, so a person typing
 * the same words about some other run still reads as a person.
 */
export function subagentEnd(prompt: string, subagents: readonly AgentMeta[]): SubagentEnd | undefined {
  const [first = '', ...more] = prompt.split('\n')
  const match = ENDED.exec(first.trim())
  const agent = match && subagents.find(candidate => candidate.id === match[1])
  if (!match || !agent) return undefined
  return { agent, status: match[2]!, ...(match[3] ? { detail: match[3] } : {}), rest: more.join('\n').trim() }
}

/**
 * When a subagent was started: the moment its id was made from, which never changes. Its card's
 * own start time moves a moment later once its process writes the card in its checkout, and a
 * row placed by that would move with it.
 */
export function subagentStartedAt(agent: Pick<AgentMeta, 'id' | 'startedAt'>): string {
  return startedAtFromAgentId(agent.id) ?? agent.startedAt
}

/**
 * A subagent the coding agent started inside its own session (its `Agent` tool, Codex's collab
 * calls), folded out of the run's events: one per `subagent` event id, as the newest of them says,
 * with how many calls it made and the last of them. It works in the run's own checkout and has no
 * branch of its own.
 */
export interface CallSubagent {
  id: string
  status: 'working' | 'ended' | 'failed'
  name?: string
  role?: string
  model?: string
  prompt?: string
  /** When its first event was written, and when the one that ended it was. */
  startedAt?: string
  endedAt?: string
  /** How many calls it made, and the tool of the last one, as its own events say. */
  calls: number
  tool?: string
}

/** The run's own subagents of its coding agent, in the order they were started. */
export function callSubagents(events: readonly OpenAgentEvent[]): CallSubagent[] {
  const byId = new Map<string, CallSubagent>()
  for (const e of events) {
    if (e.kind !== 'driver') continue
    const event = e.event
    if (event.type === 'subagent') {
      const was = byId.get(event.id)
      const { type: _type, ...said } = event
      byId.set(event.id, {
        ...said,
        calls: was?.calls ?? 0,
        ...(was?.tool !== undefined ? { tool: was.tool } : {}),
        ...((was?.startedAt ?? e.at) !== undefined ? { startedAt: (was?.startedAt ?? e.at)! } : {}),
        ...(event.status !== 'working' && e.at !== undefined ? { endedAt: e.at } : {}),
      })
    } else if (event.type === 'action' && event.subagent !== undefined) {
      const subagent = byId.get(event.subagent)
      if (subagent) byId.set(event.subagent, { ...subagent, calls: subagent.calls + 1, tool: event.label })
    }
  }
  return [...byId.values()]
}

/**
 * The events the chat shows nothing for, because a subagent's row says them: each subagent's own
 * events, the call that started it and that call's answer (the `action` and `output` of the same
 * call — on Codex the call is the part of the subagent's id before the colon), and what the
 * subagent itself said and did, which is its transcript and no step of the run's own.
 */
export function subagentEvents(events: readonly OpenAgentEvent[]): Set<OpenAgentEvent> {
  const ids = new Set<string>()
  for (const e of events) if (e.kind === 'driver' && e.event.type === 'subagent') ids.add(e.event.id)
  const calls = new Set([...ids].flatMap(id => [id, id.split(':')[0]!]))
  const hidden = new Set<OpenAgentEvent>()
  for (const e of events) {
    if (e.kind !== 'driver') continue
    const event = e.event
    if (event.type === 'subagent') hidden.add(e)
    else if ((event.type === 'action' || event.type === 'output' || event.type === 'text' || event.type === 'thought') && event.subagent !== undefined) hidden.add(e)
    else if ((event.type === 'action' || event.type === 'output') && event.id !== undefined && calls.has(event.id)) hidden.add(e)
  }
  return hidden
}

/** What one subagent of the coding agent's own said and did: its transcript, as the run's events. */
export function subagentTranscript(events: readonly OpenAgentEvent[], id: string): OpenAgentEvent[] {
  return events.filter(e => e.kind === 'driver' && (e.event.type === 'action' || e.event.type === 'output' || e.event.type === 'text' || e.event.type === 'thought') && e.event.subagent === id)
}

/**
 * A subagent as its row shows it, whichever kind it is: a run of this project's own, on a branch of
 * its own (`agent`), or one the coding agent started inside its session, which has none (`call`).
 * The status is a run's word for it, so both read alike.
 */
export interface SubagentRow {
  /** Unique among the run's subagents of both kinds. */
  key: string
  name: string
  model?: string
  status: string
  working: boolean
  startedAt: string
  endedAt?: string
  /** What it is on now and how many calls it made, while it works, when that is known. */
  tool?: string
  calls?: number
  /** What its last step was, on one line, while it works. */
  doing?: string
  cost?: number
  prompt?: string
  agent?: AgentMeta
  call?: CallSubagent
}

/** A subagent run as its row. */
export function runRow(agent: AgentMeta, doing: AgentDoing | undefined): SubagentRow {
  const working = agent.status === 'running'
  return {
    key: `run:${agent.id}`,
    name: taskLabel(agent),
    ...(agent.model !== undefined ? { model: agent.model } : {}),
    status: agent.status,
    working,
    startedAt: subagentStartedAt(agent),
    ...(agent.endedAt !== undefined ? { endedAt: agent.endedAt } : {}),
    ...(working && doing?.tool !== undefined ? { tool: doing.tool } : {}),
    ...(working && doing !== undefined ? { calls: doing.calls } : {}),
    ...(working && doing?.doing !== undefined ? { doing: doing.doing } : {}),
    ...(agent.cost !== undefined ? { cost: agent.cost } : {}),
    ...(agent.intent !== undefined ? { prompt: agent.intent } : {}),
    agent,
  }
}

/**
 * A subagent of the coding agent's own as its row. One still working when the run is not is over
 * all the same — its process went with the run's — and reads as stopped.
 */
export function callRow(call: CallSubagent, runWorking: boolean, fallbackAt: string): SubagentRow {
  const working = call.status === 'working' && runWorking
  const status = call.status === 'failed' ? 'failed' : call.status === 'ended' ? 'done' : working ? 'running' : 'stopped'
  return {
    key: `call:${call.id}`,
    name: call.name ?? call.role ?? 'Subagent',
    ...(call.model !== undefined ? { model: call.model } : {}),
    status,
    working,
    startedAt: call.startedAt ?? fallbackAt,
    ...(call.endedAt !== undefined ? { endedAt: call.endedAt } : {}),
    ...(working && call.tool !== undefined ? { tool: call.tool } : {}),
    ...(working ? { calls: call.calls } : {}),
    ...(call.prompt !== undefined ? { prompt: call.prompt } : {}),
    call,
  }
}

/**
 * Where each subagent's row goes in a log, by index into it: the subagents started in one turn are
 * one group, at the place of the first of them — before the first event written after it started,
 * or at the log's end — so a turn that started three reads as one block of three under one line
 * saying all of them. A turn begins at each event `isTurnStart` says begins one.
 */
export function subagentGroups(events: readonly OpenAgentEvent[], rows: readonly SubagentRow[], isTurnStart: (e: OpenAgentEvent) => boolean): Map<number, SubagentRow[]> {
  const turnAt: number[] = []
  for (const e of events) turnAt.push((turnAt.at(-1) ?? 0) + (isTurnStart(e) ? 1 : 0))
  const placed = rows
    .map(row => {
      const started = Date.parse(row.startedAt)
      const at = events.findIndex(e => e.at !== undefined && Date.parse(e.at) > started)
      const index = at === -1 ? events.length : at
      // The turn it was started in: the one the event before it belongs to.
      return { row, index, turn: index > 0 ? turnAt[index - 1]! : 0 }
    })
    .sort((a, b) => a.index - b.index || (a.row.startedAt < b.row.startedAt ? -1 : 1))
  const groups = new Map<number, SubagentRow[]>()
  const firstOfTurn = new Map<number, number>()
  for (const { row, index, turn: of } of placed) {
    const at = firstOfTurn.get(of) ?? index
    firstOfTurn.set(of, at)
    groups.set(at, [...(groups.get(at) ?? []), row])
  }
  return groups
}

/**
 * What a group of subagents comes to: how many, how long from the first start to the last end (or
 * now, while one works), and what they cost, summed over the ones whose cost is known — a subagent
 * of the coding agent's own has none of its own, its cost is the run's. No cost when none is known.
 */
export function rollUp(rows: readonly SubagentRow[], now: number): { count: number; ms: number; cost?: number } {
  const start = Math.min(...rows.map(row => Date.parse(row.startedAt)))
  const end = rows.some(row => row.working) ? now : Math.max(...rows.map(row => Date.parse(row.endedAt ?? row.startedAt)))
  const costs = rows.flatMap(row => (row.cost !== undefined ? [row.cost] : []))
  return { count: rows.length, ms: Math.max(0, end - start), ...(costs.length > 0 ? { cost: costs.reduce((a, b) => a + b, 0) } : {}) }
}

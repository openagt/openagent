import type { AgentDoing, AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { startedAtFromAgentId } from '../../src/agent-id.js'
import { agentLabel } from './agent-label.js'

// A run started for another run is that run's subagent: its card names the other run as its
// parent. Everything the dashboard shows about subagents (the rail's tree, the rows in the main
// agent's chat, the line above its message box) is read off that one field.

/** Runs in the order they were started: an id sorts by start time. */
function byStart(a: Pick<AgentMeta, 'id'>, b: Pick<AgentMeta, 'id'>): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** A run's subagents, in the order they were started. */
export function subagentsOf(agents: readonly AgentMeta[], id: string): AgentMeta[] {
  return agents.filter(agent => agent.parent === id).sort(byStart)
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
      subagents: rows.filter(other => under(other) === row).sort((a, b) => byStart(a.agent, b.agent)),
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
  /** How many tokens and tool calls it went through, as far as its coding agent says. */
  tokens?: number
  toolUses?: number
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

/** An event of the agent's own doing: no subagent's, no count, no turn's end. */
export function isAgentsOwn(e: OpenAgentEvent): boolean {
  if (e.kind !== 'driver') return false
  const event = e.event as { type: string; subagent?: string }
  return ['action', 'output', 'text', 'thought', 'thinking', 'partial'].includes(event.type) && event.subagent === undefined
}

/** The subagent of the coding agent's own whose step this is (a call, its answer, its words, a thought); none for any other event. */
function stepOfSubagent(e: OpenAgentEvent): string | undefined {
  if (e.kind !== 'driver') return undefined
  const event = e.event
  return event.type === 'action' || event.type === 'output' || event.type === 'text' || event.type === 'thought' ? event.subagent : undefined
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
  // A call that only drove the agent's subagents says nothing a subagent's row does not, unless it failed.
  const failed = new Set(events.flatMap(e => (e.kind === 'driver' && e.event.type === 'output' && e.event.failed === true && e.event.id !== undefined ? [e.event.id] : [])))
  const driving = new Set(
    events.flatMap(e =>
      e.kind === 'driver' && e.event.type === 'action' && e.event.subagent === undefined && e.event.id !== undefined && !failed.has(e.event.id) && drivesSubagents(e.event.whole ?? e.event.detail) ? [e.event.id] : [],
    ),
  )
  for (const e of events) if (e.kind === 'driver' && e.event.type === 'subagent') ids.add(e.event.id)
  const calls = new Set([...ids].flatMap(id => [id, id.split(':')[0]!]))
  const hidden = new Set<OpenAgentEvent>()
  for (const e of events) {
    if (e.kind !== 'driver') continue
    const event = e.event
    if (event.type === 'subagent' || stepOfSubagent(e) !== undefined) hidden.add(e)
    else if ((event.type === 'action' || event.type === 'output') && event.id !== undefined && (calls.has(event.id) || driving.has(event.id))) hidden.add(e)
  }
  return hidden
}

/** What one subagent of the coding agent's own said and did: its transcript, as the run's events. */
export function subagentTranscript(events: readonly OpenAgentEvent[], id: string): OpenAgentEvent[] {
  return events.filter(e => stepOfSubagent(e) === id)
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
  /** How many tokens and tool calls it went through, as far as its coding agent says. */
  tokens?: number
  toolUses?: number
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
    ...(call.tokens !== undefined ? { tokens: call.tokens } : {}),
    ...(call.toolUses !== undefined ? { toolUses: call.toolUses } : {}),
    call,
  }
}

/** One thing of a stretch of the chat: a subagent started, or a message one sent when it ended. */
export type SubagentStep = { kind: 'agent'; row: SubagentRow } | { kind: 'message'; row: SubagentRow; text: string }

/**
 * Where a log's subagents go, by index into it: what was started and what ended with nothing between
 * them is one stretch, at the place of the first of it — before the first event written after it, or
 * at the log's end — so it reads as one line. What comes after the agent said something is a stretch
 * of its own, after those words. `parts` says which events part what is before them from what is
 * after. `reports` holds what each subagent sent when it ended, by its row's key.
 */
export function subagentSteps(events: readonly OpenAgentEvent[], rows: readonly SubagentRow[], reports: ReadonlyMap<string, string>, parts: (e: OpenAgentEvent) => boolean): Map<number, SubagentStep[]> {
  const stretchAt: number[] = []
  for (const e of events) stretchAt.push((stretchAt.at(-1) ?? 0) + (parts(e) ? 1 : 0))
  const place = (step: SubagentStep, time: string) => {
    const when = Date.parse(time)
    const at = events.findIndex(e => e.at !== undefined && Date.parse(e.at) > when)
    const index = at === -1 ? events.length : at
    // The stretch it belongs to: the one the event before it is in.
    return { step, time, index, stretch: index > 0 ? stretchAt[index - 1]! : 0 }
  }
  const placed = rows
    .flatMap(row => {
      const report = reports.get(row.key)
      return [place({ kind: 'agent', row }, row.startedAt), ...(report !== undefined && row.endedAt !== undefined ? [place({ kind: 'message', row, text: report }, row.endedAt)] : [])]
    })
    .sort((a, b) => a.index - b.index || (a.time < b.time ? -1 : 1))
  const steps = new Map<number, SubagentStep[]>()
  const firstOf = new Map<number, number>()
  for (const { step, index, stretch } of placed) {
    const at = firstOf.get(stretch) ?? index
    firstOf.set(stretch, at)
    steps.set(at, [...(steps.get(at) ?? []), step])
  }
  return steps
}

/** What a stretch came to, in words, in the order it happened: "Ran 2 agents, received a message". */
export function stepWords(steps: readonly SubagentStep[]): string {
  const agents = steps.filter(step => step.kind === 'agent')
  const messages = steps.length - agents.length
  const failed = agents.filter(step => step.row.status === 'failed').length
  const ran = agents.length === 1 ? 'ran an agent' : `ran ${agents.length} agents`
  const received = messages === 1 ? 'received a message' : `received ${messages} messages`
  const parts = [...(agents.length > 0 ? [ran] : []), ...(messages > 0 ? [received] : [])]
  if (steps[0]?.kind === 'message') parts.reverse()
  const words = [...parts, ...(failed > 0 ? [`${failed} failed`] : [])].join(', ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A command that only starts or lands subagents or looks at them, a look at git beside it: `npx @openagt/skill-orchestration@0.1 land <id>; git status`. */
export function drivesSubagents(command: string | undefined): boolean {
  if (command === undefined) return false
  const parts = command.split(/;|&&|\n/).map(part => part.trim()).filter(Boolean)
  const orchestration = /^npx (?:-y )?@openagt\/skill-orchestration(?:@\S+)? (?:start|land|next|list|read)\b/
  return parts.some(part => orchestration.test(part)) && parts.every(part => orchestration.test(part) || /^git (?:status|log|diff)\b/.test(part))
}

/** What a subagent of the coding agent's own sent when it ended: the last thing it said. */
export function subagentReport(events: readonly OpenAgentEvent[], id: string): string | undefined {
  const said = subagentTranscript(events, id).flatMap(e => (e.kind === 'driver' && e.event.type === 'text' ? [e.event.text] : []))
  return said.at(-1)
}

/** What a run was told when its subagent ended, as a person reads it: where its work is, and what it said. */
export function endMessage(rest: string): string {
  return rest.replace(/^Its last words:\n/m, '').trim()
}

/**
 * Whether the main agent is idle on its own subagents now, and when one last woke it: its live line
 * shows no counter while it waits, and counts again from its wake, as Claude Code on the web's does.
 *
 * Claude Code on the web ends the main agent's turn while its subagents work and starts a new one
 * when a subagent's message wakes it. Our coding agent's turn stays open instead, the main agent
 * blocked on its subagent calls, so the wait is read off the events: it waits from a subagent's
 * start, or from a message it finished while one works. The last subagent's end wakes it; with
 * others still at work, its next step of its own (a thought, a call that starts no subagent, words)
 * does, when one ended meanwhile. A main agent that goes on beside its subagents never waited, and
 * its count goes on.
 */
export function subagentWait(events: readonly OpenAgentEvent[]): { waiting: boolean; wokeAt?: string } {
  const open = new Set<string>()
  // A subagent's id is the id of the call that started it (on Codex, the part before the colon):
  // that call, and what it hands back, are known by it.
  const subagents = new Set(events.flatMap(e => (e.kind === 'driver' && e.event.type === 'subagent' ? [e.event.id, e.event.id.split(':')[0]!] : [])))
  let waiting = false
  let endedMeanwhile = false
  let wokeAt: string | undefined
  for (const e of events) {
    if (e.kind !== 'driver') continue
    const event = e.event as { type: string; id?: string; status?: string; subagent?: string }
    if (event.type === 'start') {
      open.clear()
      waiting = false
      endedMeanwhile = false
      wokeAt = undefined
      continue
    }
    if (event.type === 'subagent' && event.id !== undefined) {
      if (event.status === 'working') {
        // A subagent just started; one already working only says how far it got.
        if (!open.has(event.id)) {
          if (open.size === 0) endedMeanwhile = false
          open.add(event.id)
          waiting = true
        }
      } else {
        open.delete(event.id)
        // The last one's end wakes it; with others still at work, its next step does.
        if (waiting && open.size === 0) {
          wokeAt = e.at
          waiting = false
          endedMeanwhile = false
        } else if (waiting) endedMeanwhile = true
      }
      continue
    }
    if (!isAgentsOwn(e)) continue
    // What starts a subagent, and what a subagent hands back, are no step of the main agent's own.
    if ((event.type === 'action' || event.type === 'output') && event.id !== undefined && subagents.has(event.id)) continue
    if (waiting && endedMeanwhile) wokeAt = e.at
    waiting = false
    endedMeanwhile = false
    // Its message said and its subagents still at work: it waits on them.
    if (event.type === 'text' && open.size > 0) waiting = true
  }
  return { waiting: waiting && open.size > 0, ...(wokeAt !== undefined ? { wokeAt } : {}) }
}

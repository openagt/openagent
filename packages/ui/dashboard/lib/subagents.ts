import type { RunEvent } from '@openagt/hooks'

// A run's subagents are the ones its coding agent started inside its session (Claude Code's
// `Agent` tool, Codex's collab calls), known only from the run's log, by its `subagent` events. The
// chat's rows and the pane read them.

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
  /** `stopped`: its run's process ended while it worked, and it with it. */
  status: 'working' | 'ended' | 'failed' | 'stopped'
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
export function isAgentsOwn(e: RunEvent): boolean {
  if (e.kind !== 'driver') return false
  const event = e.event as { type: string; subagent?: string }
  return ['action', 'output', 'text', 'thought', 'thinking', 'partial'].includes(event.type) && event.subagent === undefined
}

/** The subagent of the coding agent's own whose step this is (a call, its answer, its words, a thought); none for any other event. */
function stepOfSubagent(e: RunEvent): string | undefined {
  if (e.kind !== 'driver') return undefined
  const event = e.event
  return event.type === 'action' || event.type === 'output' || event.type === 'text' || event.type === 'thought' ? event.subagent : undefined
}

/**
 * The run's own subagents of its coding agent, in the order they were started. One still working
 * when the run's process ends (its `end`) ended with it: its coding agent tells of its end at its
 * call's answer and nowhere else, so without that a message that continues the run would make it
 * read as working again. A new prompt alone ends none: a subagent in the background goes on across them.
 */
export function callSubagents(events: readonly RunEvent[]): CallSubagent[] {
  const byId = new Map<string, CallSubagent>()
  for (const e of events) {
    if (e.kind === 'end') {
      for (const [id, call] of byId) if (call.status === 'working') byId.set(id, { ...call, status: 'stopped', ...(e.at !== undefined ? { endedAt: e.at } : {}) })
    }
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
export function subagentEvents(events: readonly RunEvent[]): Set<RunEvent> {
  const ids = new Set<string>()
  for (const e of events) if (e.kind === 'driver' && e.event.type === 'subagent') ids.add(e.event.id)
  const calls = new Set([...ids].flatMap(id => [id, id.split(':')[0]!]))
  const hidden = new Set<RunEvent>()
  for (const e of events) {
    if (e.kind !== 'driver') continue
    const event = e.event
    if (event.type === 'subagent' || stepOfSubagent(e) !== undefined) hidden.add(e)
    else if ((event.type === 'action' || event.type === 'output') && event.id !== undefined && calls.has(event.id)) hidden.add(e)
  }
  return hidden
}

/** What one subagent of the coding agent's own said and did: its transcript, as the run's events. */
export function subagentTranscript(events: readonly RunEvent[], id: string): RunEvent[] {
  return events.filter(e => stepOfSubagent(e) === id)
}

/** A subagent as its row shows it. The status is a run's word for it, so it reads as a run's does. */
export interface SubagentRow {
  /** Unique among the run's subagents. */
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
  /** How many tokens and tool calls it went through, as far as its coding agent says. */
  tokens?: number
  toolUses?: number
  prompt?: string
  call: CallSubagent
}

/** The parts of the pane's list, in their order: what failed, what works, what ended. */
export type ListPart = 'Failed' | 'Working' | 'Ended'

/** How many rows the pane's list holds before its ended ones fold into one line. */
export const FOLD_PAST = 8

/** Which rows stand in which part of the pane's list, by key, and whether its ended ones fold. */
export interface Arrangement {
  parts: { name: ListPart; keys: string[] }[]
  folds: boolean
}

/** The part of the pane's list each state stands in, a group's name and not the state's word: "Ended" holds done and stopped; any other state is at work. */
const PART_OF: Readonly<Partial<Record<string, ListPart>>> = { failed: 'Failed', done: 'Ended', stopped: 'Ended' }

/** Where a subagent's row stands. */
const partOf = (row: SubagentRow): ListPart => PART_OF[row.status] ?? 'Working'

const PARTS: readonly ListPart[] = ['Failed', 'Working', 'Ended']

/**
 * The pane's list of a run's subagents: each part that holds a row, in {@link PARTS}' order, its rows
 * in the order they started; past {@link FOLD_PAST} rows in all, the ended ones fold. A failed one
 * is never folded: its main agent goes on, but the person was not told.
 */
export function arrange(rows: readonly SubagentRow[]): Arrangement {
  const started = [...rows].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
  const parts = PARTS.map(name => ({ name, keys: started.filter(row => partOf(row) === name).map(row => row.key) })).filter(part => part.keys.length > 0)
  return { parts, folds: rows.length > FOLD_PAST && parts.some(part => part.name === 'Ended') }
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

/** A run's subagents as their rows, in the order they were started. `working` is whether the run's own process works. */
export function subagentRows(events: readonly RunEvent[], working: boolean): SubagentRow[] {
  const fallbackAt = events[0]?.at ?? new Date(0).toISOString()
  return callSubagents(events).map(call => callRow(call, working, fallbackAt))
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
export function subagentSteps(events: readonly RunEvent[], rows: readonly SubagentRow[], reports: ReadonlyMap<string, string>, parts: (e: RunEvent) => boolean): Map<number, SubagentStep[]> {
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

/** What a subagent of the coding agent's own sent when it ended: the last thing it said. */
export function subagentReport(events: readonly RunEvent[], id: string): string | undefined {
  const said = subagentTranscript(events, id).flatMap(e => (e.kind === 'driver' && e.event.type === 'text' ? [e.event.text] : []))
  return said.at(-1)
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
export function subagentWait(events: readonly RunEvent[]): { waiting: boolean; wokeAt?: string } {
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

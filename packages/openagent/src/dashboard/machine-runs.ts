import { isRunId, type AgentMeta, type AgentStatus } from '../store/index.js'

/**
 * The runs of another computer, as this one lists them: a laptop's on its server, a server's on
 * the laptop. Each computer answers for its own runs only, as they stand right now, over the relay
 * of the saved machine it is ({@link RunChanges}); this computer takes what it says over the
 * records of those runs it holds, which come through a project's shared records and stop at
 * whatever was shared last ({@link withMachineRuns}). So how a computer's runs stand never
 * depends on its records being shared: a computer that does not answer has its runs known by what
 * it said last, or by their records, and none of them going: their status is `unknown`.
 */

/** What a computer answers for its own runs of a project. */
export interface OwnRuns {
  /** What to ask with next time, as `since`: the answer then holds only the runs that changed after this one. */
  at: string
  /** Its runs that changed since the `since` it was asked with; every one when there was none, or one it does not know. */
  runs: AgentMeta[]
  /** Every one of its runs of the project, by id: a run the asker holds that is not here is gone. */
  ids: string[]
}

/**
 * A computer's own runs, counted as they change, per project: each answer says where it leaves
 * the asker, and the next holds what changed after that. A count from before this OpenAgent
 * started, or from no answer of its, is answered with every run.
 */
export class RunChanges {
  private readonly started = Math.random().toString(36).slice(2, 10)
  private readonly projects = new Map<string, { count: number; seen: Map<string, { said: string; at: number }> }>()

  answer(project: string, runs: readonly AgentMeta[], since?: unknown): OwnRuns {
    let known = this.projects.get(project)
    if (!known) this.projects.set(project, (known = { count: 0, seen: new Map() }))
    const ids = new Set<string>()
    for (const run of runs) {
      ids.add(run.id)
      const said = JSON.stringify(run)
      if (known.seen.get(run.id)?.said !== said) known.seen.set(run.id, { said, at: ++known.count })
    }
    for (const id of known.seen.keys()) if (!ids.has(id)) known.seen.delete(id)
    const after = this.countOf(since, known.count)
    return { at: `${this.started}.${known.count}`, runs: after === undefined ? [...runs] : runs.filter(run => known.seen.get(run.id)!.at > after), ids: [...ids] }
  }

  private countOf(since: unknown, count: number): number | undefined {
    if (typeof since !== 'string') return undefined
    const [started, at] = since.split('.')
    return started === this.started && /^\d+$/.test(at ?? '') && Number(at) <= count ? Number(at) : undefined
  }
}

/** A saved machine's runs of one project, as this computer last heard them. */
export interface MachineRuns {
  /** The computer's own name, as the records of its runs carry it. */
  host: string
  /** Its runs as it said them last, since this OpenAgent started. */
  runs: readonly AgentMeta[]
  /** It answered the last time it was asked. */
  answered: boolean
  /** When it last answered, ISO, when this computer knows. */
  seenAt?: string
}

const GOING: ReadonlySet<AgentStatus> = new Set(['running', 'waiting'])

/**
 * A project's runs with what its saved machines said of theirs: a machine's word on a run of its
 * own wins over the run's record, and a run of its own with no record here yet is listed too. A
 * machine's run that is going is going only by its machine's word just now: one whose machine did
 * not answer, or that its machine did not say, reads `unknown`, with when its machine was last
 * seen. The runs of every other computer pass through as recorded.
 */
export function withMachineRuns(records: AgentMeta[], machines: readonly MachineRuns[]): AgentMeta[] {
  if (machines.length === 0) return records
  const byHost = new Map(machines.map(machine => [machine.host, machine]))
  const said = new Map<string, AgentMeta>()
  for (const machine of machines) for (const run of machine.runs) if (run.host === machine.host) said.set(run.id, run)
  const theirs = (run: AgentMeta): AgentMeta | undefined => {
    const own = said.get(run.id)
    return own && own.host === run.host ? own : undefined
  }
  const recorded = new Set(records.map(record => record.id))
  const rows = records.map(record => theirs(record) ?? record)
  const added = [...said.values()].filter(run => !recorded.has(run.id))
  // Newest first, as the records are: a run only its machine knows goes where it started.
  const all = added.length > 0 ? [...added, ...rows].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) : rows
  return all.map(run => {
    const machine = run.host === undefined ? undefined : byHost.get(run.host)
    if (!machine || !GOING.has(run.status)) return run
    if (machine.answered && said.get(run.id) === run) return run
    return { ...run, status: 'unknown' as const, ...(machine.seenAt !== undefined ? { seenAt: machine.seenAt } : {}) }
  })
}

/** A saved machine to ask for its runs: where it answers and its computer's own name. */
export interface AskedMachine {
  url: string
  host: string
  /** When it last answered, ISO, as kept with the machine. */
  seenAt?: string
}

/** How long a machine's answer stands before it is asked again: a page asks every few seconds. */
const KEPT_MS = 5_000
/** How long a machine that did not answer is left before it is asked again. */
const UNANSWERED_MS = 10_000
/** How long a list waits for a machine's first answer: one that is off does not hold a page. */
const FIRST_WAIT_MS = 1_500
/** How many machine-and-project answers are kept before the memory starts over. */
const MAX_KEPT = 200

const RECORD_STATUSES: readonly AgentStatus[] = ['running', 'done', 'stopped', 'failed', 'waiting']

/** One of a machine's runs as it said it, when it is one of its own and reads as a run: else nothing. */
function runOf(value: unknown, host: string): AgentMeta | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const run = value as Partial<AgentMeta>
  if (typeof run.id !== 'string' || !isRunId(run.id) || typeof run.startedAt !== 'string' || typeof run.updatedAt !== 'string' || !RECORD_STATUSES.includes(run.status as AgentStatus)) return undefined
  return run.host === host ? (run as AgentMeta) : undefined
}

/**
 * What each saved machine said last of its runs of a project, asked again behind the page once
 * its answer is a few seconds old: a page is answered at once with what is known, and waits only
 * for a machine's first answer, and not long. One ask at a time per machine and project; each
 * holds only what changed since the one before ({@link OwnRuns}).
 */
export class MachineRunsKept {
  private readonly kept = new Map<string, Kept>()

  constructor(
    /** Ask the machine for its runs of the project at `address`, since what it answered last. */
    private readonly ask: (machine: AskedMachine, address: string, since: string | undefined) => Promise<unknown>,
    /** Told each time a machine answered. */
    private readonly seen: (machine: AskedMachine, at: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  async of(machines: readonly AskedMachine[], address: string): Promise<MachineRuns[]> {
    return Promise.all(
      machines.map(async machine => {
        const key = `${machine.url} ${address}`
        let entry = this.kept.get(key)
        if (!entry) {
          if (this.kept.size >= MAX_KEPT) this.kept.clear()
          this.kept.set(key, (entry = { runs: new Map(), answered: false, until: 0 }))
        }
        const first = entry.until === 0
        if (entry.until <= this.now()) {
          const held = entry
          held.asking ??= this.askAgain(machine, address, held).finally(() => (held.asking = undefined))
        }
        if (first && entry.asking) await Promise.race([entry.asking, new Promise(done => setTimeout(done, FIRST_WAIT_MS).unref())])
        const seenAt = entry.seenAt ?? machine.seenAt
        return { host: machine.host, runs: [...entry.runs.values()], answered: entry.answered, ...(seenAt !== undefined ? { seenAt } : {}) }
      }),
    )
  }

  private async askAgain(machine: AskedMachine, address: string, entry: Kept): Promise<void> {
    try {
      const said = (await this.ask(machine, address, entry.at)) as Partial<OwnRuns> | undefined
      if (!said || typeof said.at !== 'string' || !Array.isArray(said.runs) || !Array.isArray(said.ids)) throw new Error('the machine answered something else than its runs')
      for (const value of said.runs) {
        const run = runOf(value, machine.host)
        if (run) entry.runs.set(run.id, run)
      }
      const ids = new Set(said.ids)
      for (const id of entry.runs.keys()) if (!ids.has(id)) entry.runs.delete(id)
      entry.at = said.at
      entry.answered = true
      entry.seenAt = new Date(this.now()).toISOString()
      entry.until = this.now() + KEPT_MS
      this.seen(machine, entry.seenAt)
    } catch {
      // What it said last stands, and it is asked again from where that left off.
      entry.answered = false
      entry.until = this.now() + UNANSWERED_MS
    }
  }
}

/** What is kept of one machine's runs of one project. */
interface Kept {
  runs: Map<string, AgentMeta>
  /** What the machine answered last, to ask with next time. */
  at?: string
  answered: boolean
  seenAt?: string
  /** Until when the answer stands; 0 while the machine was never asked. */
  until: number
  asking?: Promise<void> | undefined
}

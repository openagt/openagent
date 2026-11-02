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
  /**
   * What to ask with next time, as `since`: the answer then holds only the runs that changed after
   * this one. The same as `since` when nothing changed.
   */
  at: string
  /** Its runs that changed since the `since` it was asked with; every one when there was none, or one it does not know. */
  runs: AgentMeta[]
  /** Every one of its runs of the project, by id: a run the asker holds that is not here is gone. */
  ids: string[]
}

/**
 * What a list shows of a run, as one string to compare: what it is, how it stands, and its name.
 * A run's card is written at every step it takes, with a later time and a higher cost, and none
 * of that is a change a person waits on.
 */
export function shownOf(run: AgentMeta): string {
  return JSON.stringify([run.id, run.status, run.title, run.branch, run.pr?.number, run.endedAt])
}

/** What is known of one project's runs as they were answered last. */
interface Counted {
  count: number
  seen: Map<string, { said: string; at: number; shown: string; shownAt: number }>
  /** The count when a run last went. */
  goneAt: number
}

/**
 * A computer's own runs, counted as they change, per project: each answer says where it leaves
 * the asker, and the next holds what changed after that. A count from before this OpenAgent
 * started, or from no answer of its, is answered with every run.
 */
export class RunChanges {
  private readonly started = Math.random().toString(36).slice(2, 10)
  private readonly projects = new Map<string, Counted>()

  answer(project: string, runs: readonly AgentMeta[], since?: unknown): OwnRuns {
    const known = this.known(project)
    const ids = new Set<string>()
    for (const run of runs) {
      ids.add(run.id)
      const said = JSON.stringify(run)
      const before = known.seen.get(run.id)
      if (before?.said === said) continue
      const at = ++known.count
      const shown = shownOf(run)
      known.seen.set(run.id, { said, at, shown, shownAt: before?.shown === shown ? before.shownAt : at })
    }
    // A run gone is a change too: an answer after it says so by its ids.
    for (const id of known.seen.keys()) {
      if (ids.has(id)) continue
      known.seen.delete(id)
      known.goneAt = ++known.count
    }
    const after = this.countOf(since, known.count)
    return { at: `${this.started}.${known.count}`, runs: after === undefined ? [...runs] : runs.filter(run => known.seen.get(run.id)!.at > after), ids: [...ids] }
  }

  /** Whether what a list shows of the runs changed after `since`, as of the last answer: a count not of this OpenAgent's says so. */
  shownSince(project: string, since: unknown): boolean {
    const known = this.known(project)
    const after = this.countOf(since, known.count)
    if (after === undefined) return true
    if (known.goneAt > after) return true
    for (const run of known.seen.values()) if (run.shownAt > after) return true
    return false
  }

  private known(project: string): Counted {
    let known = this.projects.get(project)
    if (!known) this.projects.set(project, (known = { count: 0, seen: new Map(), goneAt: 0 }))
    return known
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

/**
 * How long a computer holds a call for its runs when nothing a list shows changed since it last
 * answered: it answers at the first such change, else with what else changed once this is up, and
 * is asked again.
 */
export const RUNS_WAIT_MS = 25_000
/** How long a machine's runs of a project are followed after a page last asked for them. */
const WANTED_MS = 60_000
/** How long a machine that did not answer is left before it is asked again. */
const UNANSWERED_MS = 10_000
/** The least time between two asks of one machine for one project. */
const ASK_GAP_MS = 1_000
/** How long a machine that answered at once with no change a list shows is left: it does not hold the call, and is asked as a page reads. */
const HELD_NOT_MS = 5_000
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
 * What each saved machine says of its runs of a project, followed while a page wants them: one call
 * to each machine is kept open, which the machine answers when its runs change
 * ({@link RUNS_WAIT_MS}), and asked again at once from where the answer left off ({@link OwnRuns}).
 * So what is kept is what the machine says now, and whoever listens to the project's address is
 * told the moment it changes. A page is answered at once with what is known, and waits only for a
 * machine's first answer, and not long.
 */
export class MachineRunsKept {
  private readonly kept = new Map<string, Kept>()
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(
    /** Ask the machine for its runs of the project at `address`, since what it answered last: it answers when they change. */
    private readonly ask: (machine: AskedMachine, address: string, since: string | undefined) => Promise<unknown>,
    /** Told each time a machine answered. */
    private readonly seen: (machine: AskedMachine, at: string) => void = () => {},
    private readonly now: () => number = Date.now,
    /** Wait before the next ask. */
    private readonly pause: (ms: number) => Promise<void> = ms => new Promise(done => setTimeout(done, ms).unref()),
  ) {}

  /** The machines' runs of the project at `address`, followed from now on for a while: a page reads them every few seconds. */
  async of(machines: readonly AskedMachine[], address: string): Promise<MachineRuns[]> {
    return Promise.all(
      machines.map(async machine => {
        const key = `${machine.url} ${address}`
        let found = this.kept.get(key)
        if (!found) {
          if (this.kept.size >= MAX_KEPT) this.kept.clear()
          this.kept.set(key, (found = { machine, runs: new Map(), answered: false, asked: false, wanted: 0 }))
        }
        const entry = found
        // A machine renamed goes on being followed under its new name, and says again the runs it said under it so far.
        if (entry.machine.host !== machine.host) delete entry.at
        entry.machine = machine
        entry.wanted = this.now() + WANTED_MS
        entry.following ??= this.follow(address, entry).finally(() => (entry.following = undefined))
        if (!entry.asked) await Promise.race([(entry.first ??= new Promise<void>(done => (entry.answer = done))), new Promise(done => setTimeout(done, FIRST_WAIT_MS).unref())])
        const seenAt = entry.seenAt ?? machine.seenAt
        return { host: machine.host, runs: [...entry.runs.values()], answered: entry.answered, ...(seenAt !== undefined ? { seenAt } : {}) }
      }),
    )
  }

  /** Follow nothing more: each machine's call is let go once it is answered. */
  stop(): void {
    this.kept.clear()
  }

  /** Tell `changed` each time a machine's runs of the project at `address` change, until the answer is called. */
  listen(address: string, changed: () => void): () => void {
    let listening = this.listeners.get(address)
    if (!listening) this.listeners.set(address, (listening = new Set()))
    const listener = (): void => changed()
    listening.add(listener)
    return () => {
      listening.delete(listener)
      if (listening.size === 0 && this.listeners.get(address) === listening) this.listeners.delete(address)
    }
  }

  private async follow(address: string, entry: Kept): Promise<void> {
    while (entry.wanted > this.now() && this.kept.get(`${entry.machine.url} ${address}`) === entry) {
      const asked = this.now()
      const said = await this.askAgain(address, entry)
      const took = this.now() - asked
      const gap = said === 'nothing' ? UNANSWERED_MS : said === 'kept' && took < ASK_GAP_MS ? HELD_NOT_MS : ASK_GAP_MS - took
      entry.asked = true
      entry.answer?.()
      if (gap > 0) await this.pause(gap)
    }
  }

  /** Ask once, and keep what the machine said: whether a change a list shows was told, nothing such changed, or it did not answer. */
  private async askAgain(address: string, entry: Kept): Promise<'told' | 'kept' | 'nothing'> {
    const asked = entry.machine
    try {
      const said = (await this.ask(asked, address, entry.at)) as Partial<OwnRuns> | undefined
      // Read now: the machine may have been renamed while it held the call.
      const machine = entry.machine
      if (!said || typeof said.at !== 'string' || !Array.isArray(said.runs) || !Array.isArray(said.ids)) throw new Error('the machine answered something else than its runs')
      // A change a list shows is told: a run's step, with its later time and higher cost, is only kept.
      let changed = !entry.answered
      for (const value of said.runs) {
        const run = runOf(value, machine.host)
        if (!run) continue
        const before = entry.runs.get(run.id)
        if (!before || shownOf(before) !== shownOf(run)) changed = true
        entry.runs.set(run.id, run)
      }
      const ids = new Set(said.ids)
      for (const id of entry.runs.keys()) {
        if (ids.has(id)) continue
        entry.runs.delete(id)
        changed = true
      }
      if (machine.host === asked.host) entry.at = said.at
      entry.answered = true
      entry.seenAt = new Date(this.now()).toISOString()
      this.seen(entry.machine, entry.seenAt)
      if (!changed) return 'kept'
      this.tell(address)
      return 'told'
    } catch {
      // What it said last stands, and it is asked again from where that left off.
      if (entry.answered) {
        entry.answered = false
        this.tell(address)
      }
      return 'nothing'
    }
  }

  private tell(address: string): void {
    for (const listener of [...(this.listeners.get(address) ?? [])]) listener()
  }
}

/** What is kept of one machine's runs of one project. */
interface Kept {
  /** The machine as a page last asked for it: its name can change while it is followed. */
  machine: AskedMachine
  runs: Map<string, AgentMeta>
  /** What the machine answered last, to ask with next time. */
  at?: string
  answered: boolean
  seenAt?: string
  /** Whether the machine was asked once at least, answered or not. */
  asked: boolean
  /** Until when it is followed: a page asked for it until a while before. */
  wanted: number
  following?: Promise<void> | undefined
  /** Settled once the machine was first asked, answered or not: what a page's first read waits for. */
  first?: Promise<void>
  answer?: () => void
}

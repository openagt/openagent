import { hostname } from 'node:os'
import type { AnyDiaryLine, RunCard } from '../record.js'
import type { RecordDeps } from '../record-store.js'
import { nodeGitRunner } from '@openagt/git-branches'
import type { GitRunner, DistributionEntry, RunContext, Driver, SessionLog } from '@openagt/hooks'
import { isPidAlive } from './run-lock.js'
import type { RunnerMark } from './records.js'
import type { AskedName } from './title.js'

/**
 * What a run's process is handed beside what the run is asked, the same for a fresh run and a
 * continued one: the coding agent, and every dependency a test may stand in for, the real one when
 * absent. What a module of the run works with is the module's own (`DistributionEntry`).
 */
export interface RunDeps {
  driver: Driver
  /** The modules the run goes through: its distribution's, agent-driver's among them (`module.ts`). */
  modules: readonly DistributionEntry[]
  host?: string
  pid?: number
  /** Whether a pid is a live process here: what the run's lock asks of its holder. */
  isAlive?: (pid: number) => boolean
  now?: () => Date
  /** The git this process reads the run's project with. */
  git?: GitRunner
  logs?: RecordDeps
  log?: (line: string) => void
}

/** What a run's process works with: {@link RunDeps} as given, else the real ones. */
export interface RunProcess {
  host: string
  pid: number
  isAlive: (pid: number) => boolean
  git: GitRunner
  clock: () => string
  logs: RecordDeps
  log: (line: string) => void
}

export function runProcess(deps: RunDeps): RunProcess {
  const now = deps.now ?? (() => new Date())
  return {
    host: deps.host ?? hostname(),
    pid: deps.pid ?? process.pid,
    isAlive: deps.isAlive ?? isPidAlive,
    git: deps.git ?? nodeGitRunner(),
    clock: () => now().toISOString(),
    logs: deps.logs ?? {},
    log: deps.log ?? (() => {}),
  }
}

/** The run a leg goes on from: its record as it was, and the conversation the record names. */
export interface EarlierLeg {
  diary: AnyDiaryLine[]
  sessionId?: string
}

/**
 * One process's part of a run, a leg: a fresh run's whole life, or a continued run from its resume
 * to its next end. What agent-driver's steps share beside the run's context: what the run was
 * asked, what this process works with, and the run's record as it goes. What the other modules
 * find out is in the context's facts.
 */
export interface Leg {
  readonly repo: string
  readonly id: string
  readonly here: RunProcess
  readonly driver: Driver
  readonly model?: string
  readonly effort?: string
  /** What the agent is sent first: the run's prompt, or what continues it. */
  readonly prompt: string
  /** A text handed to the agent with that prompt alone (`run --attach`). */
  readonly attached?: string
  /** The images that prompt goes with, by their names in the image store (`run --image`). */
  readonly images?: string[]
  /** The record this leg goes on from, for a continued run; none for a fresh one. */
  readonly earlier?: EarlierLeg
  /** Another tool marked the fresh run before it was spawned: the record keeps that tool's fields. */
  readonly marked?: true
  /** The run's own marker being pushed, when it writes one, from once the run works as its accounts: the record waits on it, so it lands after. */
  marking?: Promise<void>
  /** Puts this process's environment back as it was before the run's (`RunContext.env`) went into it, once the leg ends. */
  leaveEnvironment?: () => void
  /** The run's name, asked for as the run began; stopped when the run is. */
  readonly named?: AskedName
  /** Aborted by the second signal: the agent's process tree is ended at once. */
  readonly killed: AbortSignal
  /** The run's mark: its lasting fields, this process's host and pid, and the commit its own work begins at once its checkout says. */
  mark: RunnerMark
  /**
   * The run's card: the marker's for a fresh run, the record's for a continued one, until the
   * agent's turns open the run's live record from it.
   */
  card: RunCard
  /** The live record the agent's session keeps; none until its agent has started. */
  live?: SessionLog
  /** The record as this leg wrote it. */
  recorded?: { card: RunCard; diary: AnyDiaryLine[] }
}

const LEGS = new WeakMap<RunContext, Leg>()

/** A run's context with this process's leg of the run behind it, for agent-driver's steps. */
export function withLeg(ctx: RunContext, leg: Leg): RunContext {
  LEGS.set(ctx, leg)
  return ctx
}

/** The leg behind a run's context: only a run this process runs has one. */
export function legOf(ctx: RunContext): Leg {
  const leg = LEGS.get(ctx)
  if (!leg) throw new Error(`run ${ctx.id} is not one this process runs`)
  return leg
}

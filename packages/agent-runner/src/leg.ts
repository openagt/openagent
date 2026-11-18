import { hostname } from 'node:os'
import type { Driver, SessionLog } from '@openagt/agent-driver'
import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import type { AnyDiaryLine, LogsDeps, RunCard } from '@openagt/skill-logs'
import type { SkillLink } from '@openagt/skill-branches'
import { projectGitHost, type BranchRequest, type GitHost } from './git-host.js'
import { basicSkills } from './basic-skills.js'
import { isPidAlive } from './run-lock.js'
import type { RunnerMark } from './records.js'
import type { AskedName } from './title.js'

/**
 * What a run's process is handed beside what the run is asked, the same for a fresh run and a
 * continued one: the coding agent, and every dependency a test may stand in for, the real one when absent.
 */
export interface RunDeps {
  driver: Driver
  host?: string
  pid?: number
  /** Whether a pid is a live process here: what the run's lock asks of its holder. */
  isAlive?: (pid: number) => boolean
  now?: () => Date
  git?: GitRunner
  /** The project's git host; the one the project declares when absent. */
  gitHost?: GitHost
  /** The skills linked into the checkout beside the branches skill, for the run's agent; the basic ones (`basic-skills.ts`) when absent. */
  skills?: (repo: string, agent: { ownQuestionTool?: boolean }) => Promise<readonly SkillLink[]>
  logs?: LogsDeps
  log?: (line: string) => void
}

/** What a run's process works with: {@link RunDeps} as given, else the real ones. */
export interface RunProcess {
  host: string
  pid: number
  isAlive: (pid: number) => boolean
  git: GitRunner
  gitHost: GitHost
  skills: (repo: string, agent: { ownQuestionTool?: boolean }) => Promise<readonly SkillLink[]>
  clock: () => string
  logs: LogsDeps
  log: (line: string) => void
}

export function runProcess(deps: RunDeps): RunProcess {
  const now = deps.now ?? (() => new Date())
  return {
    host: deps.host ?? hostname(),
    pid: deps.pid ?? process.pid,
    isAlive: deps.isAlive ?? isPidAlive,
    git: deps.git ?? nodeGitRunner(),
    gitHost: deps.gitHost ?? projectGitHost,
    skills: deps.skills ?? basicSkills,
    clock: () => now().toISOString(),
    logs: deps.logs ?? {},
    log: deps.log ?? (() => {}),
  }
}

/** Where a run works: a checkout of the project on its branch, or a session's own folder, which has no branch. */
export interface Workspace {
  path: string
  branch?: string
  /** The branch was gone everywhere and was just made again, for a continued run. */
  again?: true
}

/** The run a leg goes on from: its record as it was, and the conversation the record names. */
export interface EarlierLeg {
  diary: AnyDiaryLine[]
  sessionId?: string
}

/**
 * One process's part of a run, a leg: a fresh run's whole life, or a continued run from its resume
 * to its next end. What the run's steps share beside the run's context: what the run was asked,
 * what this process works with, and what each step found out for the steps after it. The steps
 * are this package's own until they move into their modules (step 3c of #2394), whose steps read
 * the run's context alone and put what they find out into its facts.
 */
export interface Leg {
  readonly repo: string
  readonly id: string
  readonly here: RunProcess
  readonly driver: Driver
  readonly model?: string
  readonly effort?: string
  /** The sessions home, for a run with no project: it works in a folder of its own there. */
  readonly sessions: string | undefined
  /** What the agent is sent first: the run's prompt, or what continues it. */
  readonly prompt: string
  /** A text handed to the agent with that prompt alone (`run --attach`). */
  readonly attached?: string
  /** The branch a fresh run was told to work on (`run --branch`): one that exists. */
  readonly branch?: string
  /** The record this leg goes on from, for a continued run; none for a fresh one. */
  readonly earlier?: EarlierLeg
  /** Another tool marked the fresh run before it was spawned: the record keeps that tool's fields. */
  readonly marked?: true
  /** The run's own marker being pushed, when it writes one: the record waits on it, so it lands after. */
  readonly marking?: Promise<void>
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
  checkout?: Workspace
  /** The live record the agent's session keeps; none until its agent has started. */
  live?: SessionLog
  /** The question the last turn asked, when the run ended waiting. */
  question?: string
  worked: Worked
  /** The record as this leg wrote it. */
  recorded?: { card: RunCard; diary: AnyDiaryLine[] }
  /** The branches the reclaim deleted with the checkout. */
  deleted?: readonly string[]
  /** Whether the checkout went once the remote had its branch, or stayed and why. */
  reclaimed?: { reclaimed: true } | { reclaimed: false; reason: string }
}

/** Where the work ended up, read back once the agent's turns are over: the branch the agent left it on, and the pull request read back off that branch. */
export interface Worked {
  branch?: string
  pr?: BranchRequest
  /** The requests the run opened before the one its card names, once it has had any. */
  earlierPrs?: BranchRequest[]
}

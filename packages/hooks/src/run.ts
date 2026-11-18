import type { Driver, DriverEvent } from '@openagt/agent-driver'
import type { ProjectRef } from './project.js'
import type { Settings } from './settings.js'
import type { Store } from './store.js'

/** How far a run takes its work when its agent finishes: a commit, its branch pushed, its pull request, or the request set to merge once its checks pass. */
export const PUBLISH_LEVELS = ['commit', 'branch', 'pr', 'merge'] as const
export type Publish = (typeof PUBLISH_LEVELS)[number]

/**
 * A run's options: one slice per module, each written by the module's control under the message
 * box, read by its run step, and kept on the run's record. A preset is a saved set of them. A
 * module's slice is declared here when the module moves onto the hooks.
 */
export interface RunOptions {
  'agent-driver'?: AgentDriverOptions
  github?: GithubOptions
  'git-branches'?: GitBranchesOptions
  skills?: SkillsOptions
  /** The Auto menu's pick, which git-branches and github act on: how far the run takes its work; absent, only what its prompt asks. */
  publish?: Publish
  plugins?: PluginsOptions
}

/** agent-driver's slice: the coding agent, its model and effort, and the accounts its turns take. */
export interface AgentDriverOptions {
  /** The coding agent, by the name a person picks it by (`claude`, `codex`). */
  driver?: string
  model?: string
  effort?: string
  /** The Claude accounts the run's turns take, in order, as the Permissions page names them. */
  claude?: string[]
  /** The Codex accounts, the same way. */
  codex?: string[]
}

/** github's slice: the account the run works as, and the branch its pull request goes into. */
export interface GithubOptions {
  /** One of OpenAgent's own GitHub accounts, by its login; the computer's pick when absent. */
  account?: string
  /** The branch the run's pull request goes into; the repository's default branch when absent. */
  prBase?: string
}

/** git-branches' slice: where the run's own branch starts. */
export interface GitBranchesOptions {
  /** A branch of this clone, or origin's copy of one; origin's default branch when absent. */
  base?: string
}

/** skills' slice: which of the project's own skills the run gets. */
export interface SkillsOptions {
  /** None, or the ones named; every one when absent. A named skill the project does not have is not there. */
  project?: 'none' | string[]
}

/** The loader's own slice. */
export interface PluginsOptions {
  /** The enabled plugins this run goes without: the loader calls none of their run hooks for it. A core module named here is still on. */
  without?: string[]
}

/** How a run ended, as its finishing steps read it. */
export type RunOutcome = { status: 'done' | 'waiting' | 'stopped' } | { status: 'failed'; error: string }

/** Where a run stands: working, or how it ended. */
export type RunStatus = 'working' | RunOutcome['status']

/** What a run resumes with: a message, or the answer to the question it stopped on. */
export interface RunInput {
  text?: string
  answer?: string
}

/**
 * What a run's steps share, from the first to the last: what one step sets, the next reads (the
 * skills step links into the worktree the workspace step made).
 */
export interface RunContext {
  readonly id: string
  /** The project the run is in; none for a session with no project. */
  readonly project?: ProjectRef
  /** What the person asked. */
  readonly prompt: string
  readonly options: RunOptions
  /** What a resume brings; none on the run's first start. */
  readonly resume?: RunInput
  /** The folder the agent works in, set at `RunOrder.WORKSPACE`. */
  workspace?: string
  /** Sentences the prompt gets before the agent starts, added by the steps before `RunOrder.RUN`. */
  readonly context: string[]
  /** Variables the agent's environment gets, added at `RunOrder.ACCOUNTS`. */
  readonly env: Record<string, string>
  /** What each module found out about the run, by the module's name (github's pull request, git-branches' branch): kept on its record. */
  readonly facts: Record<string, unknown>
  /** How the run ended: set by the agent's turns, read by the finishing steps. */
  outcome?: RunOutcome
  /** Aborted when the run is asked to stop. */
  readonly signal: AbortSignal
  readonly store: Store
  readonly settings: Settings
}

/** A step of the run pipeline. */
export interface RunStep {
  /** Where it stands: a `RunOrder`, or any number between. */
  order: number
  /** What it does, in a few words, for the run's log and its errors: "make the worktree". */
  name: string
  run(ctx: RunContext): void | Promise<void>
}

/** A skill a module hands its runs: linked into the run's worktree for every coding agent. */
export interface RunSkill {
  /** Its name, as its `SKILL.md` front matter says it. */
  name: string
  /** Its folder: `SKILL.md` and the files beside it. */
  dir: string | URL
  /** The command it teaches, by its package's bin name: linked into the worktree with it. */
  command?: string
}

/** What a module is asked its skills with. */
export interface SkillArgs {
  /** The project the run is in; none for a session with no project. */
  project?: ProjectRef
  /** The coding agent the run is on, by its id (`claude-code`): one with its own ask tool needs no skill that teaches asking. */
  driver?: string
  options?: RunOptions
}

/** A module's skills for a run: none where they do not apply (github's on a project that is not on GitHub). */
export type RunSkills = (args: SkillArgs) => RunSkill[] | Promise<RunSkill[]>

/** A coding agent: the agent-driver contract. */
export type RunAgent = Driver

/** What a run's stream carries. */
export type RunEvent = DriverEvent

/** Starting a run, as a host is asked it. */
export interface RunRequest {
  /** The project, by the registry's id; none for a session with no project. */
  project?: string
  prompt: string
  options: RunOptions
}

/** A run, as a host lists it. */
export interface RunSummary {
  id: string
  project?: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  /** Its short name, once something named it. */
  title?: string
  prompt: string
}

/** Where runs live and are read: this computer by default; plugins add another computer, a GitHub Actions runner, a cloud session. */
export interface RunHost {
  /** What a run's options and records name it by. */
  id: string
  /** Its name in the "Run on" picker. */
  label: string
  start(request: RunRequest): Promise<{ id: string }>
  /** Go on with a run that ended or stopped on a question. */
  resume(id: string, input: RunInput): Promise<void>
  /** Send a working run a message, read between two of its agent's steps. */
  steer(id: string, text: string): Promise<void>
  /** Stop a working run: politely, letting the agent finish its step; with `force`, at once. */
  stop(id: string, opts?: { force?: boolean }): Promise<void>
  /** The runs it has, one project's or every one's, newest first. */
  list(project?: string): Promise<RunSummary[]>
  /** A run's events from its start, then each one as it comes, until the run ends or `signal` aborts. */
  events(id: string, signal: AbortSignal): AsyncIterable<RunEvent>
  /** A file of the run's checkout, by its path there; none when there is no such file. */
  file?(id: string, path: string): Promise<string | undefined>
  /** What the run changed, as a unified diff from where its branch started; none for a run with no checkout. */
  diff?(id: string): Promise<string | undefined>
}

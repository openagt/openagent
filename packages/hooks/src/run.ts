import type { Driver, DriverEvent, DriverReadiness, InboxLine } from '@openagt/agent-driver'
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
  presets?: PresetsOptions
}

/** agent-driver's slice: the coding agent, its model and effort, and the accounts its turns take. */
export interface AgentDriverOptions {
  /** The coding agent, by the name a person picks it by (`claude`, `codex`). */
  driver?: string
  model?: string
  effort?: string
  /** The Claude accounts the run's turns take, in order, as the Permissions page names them; every one of the computer's when none of them is on it. */
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

/** git-branches' slice: where the run's own branch starts, or the branch it works on; and, for a run with no project, the repos it has. */
export interface GitBranchesOptions {
  /** A branch of this clone, or origin's copy of one; origin's default branch when absent. */
  base?: string
  /** A branch that exists, worked on in place of a fresh one: a person's pull request's. */
  branch?: string
  /** For a run with no project: the repos copied into its folder, each under its name there. */
  repos?: { name: string; from: string }[]
}

/** skills' slice: the skills the run gets beside the ones every run gets, and which of the project's own. */
export interface SkillsOptions {
  /** Skills the run gets on top of the ones every run gets, by name. */
  on?: string[]
  /** Skills every run gets that this one goes without, by name. */
  off?: string[]
  /**
   * Which of the project's own skills the run gets: every one, none, or the ones named. Absent, its
   * preset's, and every one when that names none. A named skill the project does not have is not there.
   */
  project?: 'all' | 'none' | string[]
}

/** The loader's own slice. */
export interface PluginsOptions {
  /** The enabled plugins this run goes without: the loader calls none of their run hooks for it. A core module named here is still on. */
  without?: string[]
}

/** presets' slice: the preset the run is on, whose options it gets under the ones picked for it. */
export interface PresetsOptions {
  /** The preset, by its id; Default when absent. */
  preset?: string
}

/**
 * What each module found out about a run, by the module's name: one module's steps hand the next
 * what they found (github reads the branch git-branches read back), and the run's record keeps it,
 * so a resume starts from it. A module's facts are declared here when the module moves onto the hooks.
 */
export interface RunFacts {
  'git-branches'?: GitBranchesFacts
  github?: GithubFacts
}

/** git-branches' facts: the run's branch and where its own work begins on it, and how its checkout went. */
export interface GitBranchesFacts {
  /** The branch the run's work is on: the one its checkout was made on, then the one the agent left it on. None for a folder with no branch. */
  branch?: string
  /** The commit the run's own branch was made at, where its own work begins; none for a branch it was given. */
  baseCommit?: string
  /** The run's branch was gone everywhere, and was made again for this resume from where its base is now. */
  again?: true
  /** How the run's checkout went once the run ended: reclaimed, with the branches that went with it, or kept and why. */
  reclaimed?: { reclaimed: true; deleted?: string[] } | { reclaimed: false; reason: string }
}

/** A pull request, as a run's facts name it. */
export interface PullRequest {
  number: number
  url: string
}

/** github's facts: the run's pull request, and the ones it opened before it. */
export interface GithubFacts {
  /** The login of the GitHub account the run works as, kept on its record: a resume goes on as it. */
  account?: string
  /** The pull request the run's branch has. */
  pr?: PullRequest
  /** The requests the run opened before that one, once it has had any. */
  earlierPrs?: PullRequest[]
}

/** How a run ended, as its finishing steps read it. */
export type RunOutcome = { status: 'done' | 'waiting' | 'stopped' } | { status: 'failed'; error: string }

/** Where a run stands: working, or how it ended. */
export type RunStatus = 'working' | RunOutcome['status']

/** What a run resumes with: a message, or the answer to the question it stopped on. */
export interface RunInput {
  text?: string
  answer?: string
  /** With a message: how far the run takes its work from it on, when the person changed it: a level, or `nothing`. */
  publish?: Publish | 'nothing'
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
  /**
   * Variables the run works with, added at `RunOrder.ACCOUNTS`: the account it works as at its git
   * host, say. Its agent's environment gets them, and so does the run's own git (its checkout's
   * fetch, its record's push).
   */
  readonly env: Record<string, string>
  /** What each module found out about the run (github's pull request, git-branches' branch): kept on its record. */
  readonly facts: RunFacts
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
  /** The project the run is in; none for a session with no project. */
  project?: ProjectRef
  prompt: string
  options: RunOptions
  /**
   * The run's short name, as whoever starts the run is already asking for it, so the run does not
   * ask again; `false` where runs are not named (the person's setting). The host has it named when absent.
   */
  title?: Promise<string | undefined> | false
}

/** A run, as a host is asked about it: its id, and the project it is in; none for a session with no project. */
export interface RunRef {
  id: string
  project?: ProjectRef
}

/** What stands in the way of a run on a host: problems stop it, warnings do not, and a fix a press can run. */
export type RunReadiness = DriverReadiness

/** A run, as a host lists it. */
export interface RunSummary {
  id: string
  /** The project it is in, by its id; none for a session with no project. */
  project?: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  /** Its short name, once something named it. */
  title?: string
  prompt: string
}

/** This computer's host, agent-driver's, by its id: where a run runs when no other host is picked. */
export const LOCAL_HOST = 'here'

/**
 * Where runs live and are read: this computer by default; plugins add another computer, a GitHub
 * Actions runner, a cloud session. What a host refuses (a run that already ended, a coding agent
 * that cannot start) throws, its message in words for the person.
 */
export interface RunHost {
  /** What a run's options and records name it by. */
  id: string
  /** Its name in the "Run on" picker. */
  label: string
  /** What would stop a run started here with these options, asked before the Start. */
  check?(request: Pick<RunRequest, 'project' | 'options'>): Promise<RunReadiness>
  /** Start a run, answered as soon as the run has its id: the run goes on on its own. */
  start(request: RunRequest): Promise<{ id: string }>
  /** Go on with a run that ended or stopped on a question. */
  resume(run: RunRef, input: RunInput): Promise<void>
  /**
   * Say one line to a run: a working run takes it between two of its agent's steps, or when its
   * turn ends for a line sent for later; a run that has ended goes on with a message or an answer,
   * as `resume` does.
   */
  steer(run: RunRef, line: InboxLine): Promise<void>
  /** Stop a working run: politely, letting the agent end its turn where it is; with `force`, at once. */
  stop(run: RunRef, opts?: { force?: boolean }): Promise<void>
  /** The runs it has in a project, or with no project, newest first. */
  list(project?: ProjectRef): Promise<RunSummary[]>
  /** A run's events from its start, then each one as it comes, until the run ends or `signal` aborts. The panes read a run through its host from #2394's step 5. */
  events?(run: RunRef, signal: AbortSignal): AsyncIterable<RunEvent>
  /** A file of the run's checkout, by its path there; none when there is no such file. */
  file?(run: RunRef, path: string): Promise<string | undefined>
  /** What the run changed, as a unified diff from where its branch started; none for a run with no checkout. */
  diff?(run: RunRef): Promise<string | undefined>
}

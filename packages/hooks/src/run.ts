import type { DriverEvent, DriverReadiness, InboxLine, Question, RunAgent } from './agent.js'
import type { ProjectRef } from './project.js'
import type { Settings } from './settings.js'
import type { Store } from './store.js'

/** How far a run takes its work when its agent finishes: a commit, its branch pushed, its pull request, or the request set to merge once its checks pass. */
export const PUBLISH_LEVELS = ['commit', 'branch', 'pr', 'merge'] as const
export type Publish = (typeof PUBLISH_LEVELS)[number]

/**
 * A run's options: one slice per module, each written by the module's control under the message
 * box, read by its run step, and kept on the run's record. A profile is a saved set of them. A
 * module's slice is declared here when the module moves onto the hooks.
 */
export interface RunOptions {
  /** Where the run runs, by its host's id (`RunHost.id`): this computer's when absent. */
  host?: string
  'agent-driver'?: AgentDriverOptions
  github?: GithubOptions
  'git-branches'?: GitBranchesOptions
  skills?: SkillsOptions
  /** The Auto menu's pick, which git-branches and github act on: how far the run takes its work; absent, only what its prompt asks. */
  publish?: Publish
  plugins?: PluginsOptions
  profiles?: ProfilesOptions
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

/** git-branches' slice: where the run's own branch starts, or the branch it works on; and the repos it has as context. */
export interface GitBranchesOptions {
  /** A branch of this clone, or origin's copy of one; origin's default branch when absent. */
  base?: string
  /** A branch that exists, worked on in place of a fresh one: a person's pull request's. */
  branch?: string
  /** The repos copied into the session's folder, each under its name there: where a run with no project works, beside the checkout of a run in a project. */
  repos?: { name: string; from: string }[]
}

/** skills' slice: which of the project's own skills the run gets. The modules' skills are their plugins' to switch (`PluginsOptions`). */
export interface SkillsOptions {
  /**
   * Which of the project's own skills the run gets: every one, none, or the ones named. Absent, its
   * profile's, and every one when that names none. A named skill the project does not have is not there.
   */
  project?: 'all' | 'none' | string[]
}

/** The loader's own slice. */
export interface PluginsOptions {
  /** The enabled plugins this run goes without, by name: the loader calls none of their run hooks for it, so it gets none of their skills. A core module named here is still on. */
  without?: string[]
}

/** profiles' slice: the profile the run is on, whose options it gets under the ones picked for it. */
export interface ProfilesOptions {
  /** The profile, by its id; Default when absent. */
  profile?: string
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
  /**
   * The copies of the run's repos (`GitBranchesOptions.repos`) made for this start of a run in a
   * project, beside its checkout: the folder they are in, the branch each is on, and the repos
   * copied now. The agent is told where they are, at `RunOrder.CONTEXT`.
   */
  copies?: { folder: string; branch: string; made: { name: string; from: string }[] }
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

/** How a run ended, as its finishing steps read it: one that waits, waits on the question its last turn asked. */
export type RunOutcome = { status: 'done' | 'stopped' } | { status: 'waiting'; question: string } | { status: 'failed'; error: string }

/** Where a run stands: working, or how it ended. */
export type RunStatus = 'working' | RunOutcome['status']

/** What a run resumes with: a message, or the answer to the question it stopped on. */
export interface RunInput {
  text?: string
  answer?: string
  /** With a message: how far the run takes its work from it on, when the person changed it: a level, or `nothing`. */
  publish?: Publish | 'nothing'
  /** With a message: the images it goes with, by the names this computer keeps them under ({@link DriverPromptOptions.images}). */
  images?: string[]
}

/**
 * What a run's steps share, from the first to the last: what one step sets, the next reads (the
 * skills step links into the worktree the workspace step made).
 */
export interface RunContext {
  readonly id: string
  /** The project the run is in; none for a session with no project. */
  readonly project?: ProjectRef
  /** What the person asked: the run's first prompt, also on a resume, which brings its own (`resume`). */
  readonly prompt: string
  readonly options: RunOptions
  /** What a resume brings; none on the run's first start. */
  readonly resume?: RunInput
  /** The folder the agent works in, set at `RunOrder.WORKSPACE`. */
  workspace?: string
  /** The skills the run's modules give it (`run.skills`), the plugins it goes without left out: linked where it works at `RunOrder.SKILLS`. */
  readonly skills: readonly RunSkill[]
  /** What the steps before `RunOrder.RUN` tell the agent: handed over with the first prompt the run's process sends, after an empty line each. */
  readonly context: string[]
  /**
   * Variables the run works with, added at `RunOrder.ACCOUNTS`: the account it works as at its git
   * host, say. Its agent's environment gets them, and so does the run's own git (its checkout's
   * fetch, its record's push).
   */
  readonly env: Record<string, string>
  /** What each module found out about the run (github's pull request, git-branches' branch): kept on its record. */
  readonly facts: RunFacts
  /**
   * How the run asks the person, set before `RunOrder.RUN` by the module that asks (ask): a turn
   * that ends on a question then ends the run `waiting`, its question waiting for the answer that
   * resumes it. Without it, a turn that asks just ends the run: the person replies with a message.
   */
  asking?: RunAsking
  /** How the run ended: set by the agent's turns, read by the finishing steps. */
  outcome?: RunOutcome
  /** Aborted when the run is asked to stop. */
  readonly signal: AbortSignal
  readonly store: Store
  readonly settings: Settings
}

/** How a run asks the person: what the module that asks set on its context (`RunContext.asking`). */
export interface RunAsking {
  /**
   * The question a turn's last message ends on, written the module's way (ask's `await-choices`
   * block); none for a message that asks nothing. A question the agent asked with a tool of its
   * own is the turn's already.
   */
  questionIn(text: string): Question | undefined
}

/** A question a run stopped on, as its record holds it: the agent's question, with the id an answer names it by. */
export interface RunQuestion extends Question {
  /** Its id in the run: the time it was asked, so a run's second question is not its first. */
  id: string
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
  /** The coding agent the run is on (`claude-code`): one with its own ask tool needs no skill that teaches asking. */
  agent?: Pick<RunAgent, 'id' | 'ownQuestionTool'>
  options?: RunOptions
}

/** A module's skills for a run: none where they do not apply (github's on a project that is not on GitHub). */
export type RunSkills = (args: SkillArgs) => RunSkill[] | Promise<RunSkill[]>

/** What a run's stream carries. */
export type RunEvent = DriverEvent

/** Starting a run, as a host is asked it. */
export interface RunRequest {
  /** The project the run is in; none for a session with no project. */
  project?: ProjectRef
  prompt: string
  /** The images the prompt goes with, by the names this computer keeps them under ({@link DriverPromptOptions.images}): only a host on this computer takes them. */
  images?: string[]
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

/**
 * Where one run's work is, as its host knows it: facts, never a verdict about what the run's files
 * are. The panes read the work there themselves (the checkout, else the branch, the commit its pull
 * request merged as, or the one it landed at).
 */
export interface RunFound {
  /** The run's own checkout while it has one, on this computer: an absolute path. */
  checkout?: string
  /** The run's record, when its host keeps one for it. */
  record?: {
    status?: string
    /** The machine the run ran on. */
    host?: string
    /** The branch the run left its work on, by its last recorded name. */
    branch?: string
    pr?: { number: number }
    /** The branch the run was told to start from, by its name; absent on a run that started from origin's default branch. */
    base?: string
    /** The commit the run's own work begins at, for a run that made its own branch: what its changes are measured from when the default branch cannot tell them. */
    baseCommit?: string
    /** The last commit of the run's work, once its main agent landed it: its branch is gone, and its work is read here. */
    landed?: string
  }
  /** The run ended on this machine without a pull request and was not landed, so a branch it no longer has held nothing. */
  changedNothing: boolean
}

/** This computer's host, agent-driver's, by its id: where a run runs when no other host is picked. */
export const LOCAL_HOST = 'here'

/**
 * Where runs live and are read: this computer by default; plugins add a GitHub Actions runner, a
 * cloud session. What a host refuses (a run that already ended, a coding agent
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
  /** Where a run's work is, for the panes that show it (`RpcHost.run`); none for a run this host does not have. */
  find(run: RunRef): Promise<RunFound | undefined>
  /** A run's events from its start, then each one as it comes, until the run ends or `signal` aborts. Not asked yet: the dashboard tails the diary of a run of this computer's itself. */
  events?(run: RunRef, signal: AbortSignal): AsyncIterable<RunEvent>
}

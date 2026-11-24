import { errorMessage, projectId, projectNameOf, repositoryAddress, sessionsHomeOf, type GitRunner } from '@openagt/agent-data'
import { continuationPrompt } from '../question.js'
import { findRun, readDiary } from '../record-store.js'
import { type RunCard, type RunStatus } from '../record.js'
import { createHooks, type DistributionEntry, type ProjectRef, type RunFacts, type RunInput, type RunOptions as ModuleOptions } from '@openagt/hooks'
import type { SessionRepo } from '@openagt/git-branches'
import { runProcess, withLeg, type Leg, type RunDeps } from './leg.js'
import { earlierPrs, lasting, markerCard, runnerMark, type Publish, type RunnerMark } from './records.js'
import type { ProjectSkillsPick } from './profile.js'
import { withRunLock } from './run-lock.js'
import { askName, isBareCommand, type AskedName } from './title.js'
import { detailOf, modelOf } from './session.js'

/**
 * One run (#1774): one pipeline of steps (`@openagt/hooks`' `run.step`), each the part of a module
 * of the run's distribution: the checkout from git-branches, the run's skills linked into it (the
 * ones its modules give it, `run.skills`, asked before its first step), the
 * agent's session with the prompt once and the agent's own loop to the end (`session.ts`), then
 * where the work went read back, the record saved (`module.ts`), the checkout reclaimed and the
 * person told. A step that prepares the run and fails ends it failed, recorded with what went
 * wrong; the steps that finish it run whatever its end. This process records the run and reclaims
 * the checkout when the agent stops; a run that dies is caught by the sweep, which a scheduler
 * runs on every tick.
 *
 * The session keeps the run's live record itself, the card and the diary under `.openagent/`
 * in the checkout, in the run record's shape; this process adds its mark, the pid and the host,
 * and copies the two files onto the branch unchanged when the run ends. When the last turn ended
 * on a question and nothing waited in its inbox, the run ends `waiting`, keeps its checkout, and
 * the answer resumes it (`resumeRun`): the same run, the same record, continued.
 *
 * SIGINT or SIGTERM to this process stops the run: before its agent starts, the steps still to
 * prepare it are skipped; once it has, the agent is asked to end its turn where it is, and its
 * conversation keeps everything up to there. The run is recorded `stopped`, and the checkout is
 * reclaimed when its branch holds all of it. A second signal ends the agent's process tree at once.
 * That is what a dashboard's Stop sends, the pid being on the live card. A message to a stopped run
 * continues it, as one to any ended run does.
 *
 * One-shot: `agent-runner run <prompt>` runs on its own. A scheduler's tick spawns the same thing
 * with the marker already written and the id chosen.
 *
 * The pull request a run's branch has is read back through the git host the project declares
 * (`git-host.ts`); a project with no git host package records none.
 *
 * A run may be started from a branch other than origin's default (`run --base <ref>`), and with
 * its pull request going into one (`run --pr-base <branch>`); both are on its record for its whole
 * life.
 *
 * A run started in the sessions home has no project: it works in a folder of its own there
 * (`session-folder.ts`), with no branch, no pull request and nothing to reclaim, and its record is
 * kept with the other sessions' (`@openagt/agent-data`'s sessions).
 */

/** Filesystem-safe, time-ordered id from an ISO start: the shape the dashboard sorts runs by. */
export function runIdFrom(startedAt: string): string {
  return startedAt.replace(/[:.]/g, '-')
}

/**
 * What a run is asked: its prompt, and how far and from where it takes its work. The same whether
 * the run goes on in this process, in a process spawned for it (`runner.ts`), or detached.
 */
export interface RunRequest {
  /** What the agent is told, usually a slash command. */
  prompt: string
  /** The model the session starts on (`run --model`); the coding agent's own default when absent. */
  model?: string
  /** How hard that model may think (`run --effort`); the coding agent's own default when absent. */
  effort?: string
  /** How far the agent publishes when it finishes (`run --publish`); absent, only what the prompt itself asks. */
  publish?: Publish
  /** A text handed to the agent with the prompt, after it (`run --attach`), such as what a scheduler's check found: the record keeps it apart from the prompt, which stays the run's name. */
  attached?: string
  /** The images the prompt goes with, by their names in this computer's image store (`run --image`): the agent looks at them with it. */
  images?: string[]
  /** The branch the run's fresh branch starts from (`run --base`); origin's default branch when absent. */
  base?: string
  /** The branch the run's pull request goes into (`run --pr-base`); the repository's default branch when absent. */
  prBase?: string
  /** The branch to work on (`run --branch`), one that exists, such as a person's pull request's; a fresh `agent-<id>` when absent. */
  branch?: string
  /** What the run is started for (`run --for`), kept on its mark: a thread on the git host, by its address. */
  for?: string
  /** The repos a session has as context (`run --repos`), each copied into its folder; kept on its mark. */
  repos?: SessionRepo[]
}

/** What the profile a run is on brings each of its legs. */
interface OnProfile {
  /** The profile's run options, as it stands at this leg: the ones the run's record keeps go over them. None when absent. */
  profileOptions?: ModuleOptions
}

export interface RunOptions extends RunRequest, RunDeps, OnProfile {
  /**
   * The run's name, already being asked for by whoever starts the run, from before it could make
   * this run's driver ({@link namedAtStart}); asked for here as the run begins when absent.
   */
  naming?: AskedName
  /** The run's id; minted from the start time when absent. */
  id?: string
  /**
   * When the run was asked for, ISO: the start its record holds. A scheduler asks, then marks and
   * spawns, and the seconds between belong to the run: its marker and its record name one start.
   * This process's clock when absent.
   */
  startedAt?: string
  /** Whether the run's marker is already on the branch: a scheduler's tick writes it before it spawns. A person's run marks itself. */
  marked?: boolean
  /**
   * The account asked for at the git host: the session's pick, or its profile's; the account runs
   * use when absent. The run's record keeps the one it works as, as its git host's module says.
   */
  gitAccount?: string
  /** The profile the run is on, by its id (`OPENAGENT_PROFILE`), kept on its mark; Default when absent. */
  profile?: string
  /** The session's picks, kept on its mark (`profile.ts` SessionPicks): the enabled plugins it goes without, which of the project's own skills stay in its checkout. */
  pluginsWithout?: string[]
  projectSkills?: ProjectSkillsPick
}

export interface RunOutcome {
  id: string
  status: Exclude<RunStatus, 'running'>
  branch?: string
  pr?: { number: number; url: string }
  cost?: number
  /** Whether the checkout went once the remote had its branch, or stayed and why. */
  checkout: { reclaimed: true } | { reclaimed: false; reason: string }
  detail?: string
}

/**
 * Whether a run is named the moment it starts: not a run another tool marked, whose marker may
 * carry its name, nor a bare command, named from its report (`title.ts`); and not when the person
 * turned naming off (`OPENAGENT_NAME_RUN=0`).
 */
export function namedAtStart(opts: { prompt: string; marked?: boolean }): boolean {
  return process.env.OPENAGENT_NAME_RUN !== '0' && !opts.marked && !isBareCommand(opts.prompt)
}

export async function runCommand(repo: string, opts: RunOptions): Promise<RunOutcome> {
  needsAgentDriver(opts.modules)
  const here = runProcess(opts)
  const startedAt = opts.startedAt ?? here.clock()
  const id = opts.id ?? runIdFrom(startedAt)
  const mark: RunnerMark = { host: here.host, pid: here.pid, ...lasting(opts) }

  return withRunLock(repo, id, here, async () => {
    // A person's run marks itself once it works as its accounts (agent-driver's step, `module.ts`);
    // a scheduler's run was marked before it was spawned. The marker never writes `.git/config`, so
    // the agent's own git is never locked out by it. The run's record waits on it, so it lands after.
    const card = markerCard({ id, startedAt, prompt: opts.prompt, driver: opts.driver.id, ...modelOf(opts.model), mark })

    // The run's short name is asked for first of all, beside the checkout and the agent's start
    // rather than after them: the name is the first thing a person watching the run waits on, and
    // asking takes seconds of its own (`title.ts`). Earlier still when whoever starts the run asked
    // already (`runProject`, before the git host's account is read), and only for a run that is
    // named at start ({@link namedAtStart}).
    const named = opts.naming ?? (namedAtStart(opts) ? askName(opts.driver, opts.prompt) : undefined)

    return runLeg(
      {
        repo,
        id,
        here,
        driver: opts.driver,
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
        prompt: opts.prompt,
        ...(opts.attached !== undefined ? { attached: opts.attached } : {}),
        ...(opts.images !== undefined && opts.images.length > 0 ? { images: opts.images } : {}),
        ...(opts.marked ? { marked: true } : {}),
        ...(named ? { named } : {}),
        mark,
        card,
      },
      { modules: opts.modules, facts: {}, ...(opts.branch !== undefined ? { branch: opts.branch } : {}), ...(opts.profileOptions ? { profile: opts.profileOptions } : {}) },
    )
  })
}

export interface ResumeOptions extends RunDeps, OnProfile {
  /** The run to continue: one that ended `waiting`, or any ended run whose session the driver can resume. */
  id: string
  /** The user's words to the agent; or, with `answer`, absent. */
  text?: string
  /** The images the words go with, by their names in this computer's image store. */
  images?: string[]
  /** The chosen label or labels, answering the question the run's last turn asked. */
  answer?: string
  /** How far the run takes its work from here on: a level, or `null` for none; the level its record names when absent. */
  publish?: Publish | null
  /** Who resumes the run, kept on its mark with the time: a scheduler's row, which counts the run as its own from then on. */
  by?: string
  /** The model this leg starts on; the record's own when absent. */
  model?: string
  /** How hard the model may think on this leg; the record's own when absent. */
  effort?: string
}

/**
 * Continue an ended run: the same id, the same record, the same branch. The checkout is the one
 * the run kept, or a new one attached to its branch; a branch that went with the checkout, for
 * holding nothing, starts again from the base the record names, or origin's default branch. The session resumes by the id the
 * record carries; the diary goes on from where it stopped. A conversation the coding agent no
 * longer has, or a record that names none, is not the end of the run: it goes on in a fresh one,
 * whose agent reads the run's record first (`afresh`). The prompt is the user's text, or the
 * continuation of the question the run ended on with the given answer. The sentence of the publish
 * level the record keeps, or of the one the resume gives the run from here on, is said after it. A run whose work was landed, its branch gone
 * with that, is no longer recorded as landed once it is on a branch made again: what it does from
 * here is not.
 */
export async function resumeRun(repo: string, opts: ResumeOptions): Promise<RunOutcome> {
  needsAgentDriver(opts.modules)
  const here = runProcess(opts)
  // Another process of this run, the one that ended it and still records and reclaims, or a
  // resume started just before this one, goes first: this one waits, then reads the run as that
  // one left it.
  return withRunLock(repo, opts.id, here, async () => {
    const card = await findRun(repo, opts.id, here.logs)
    if (!card) throw new Error(`no run ${opts.id}`)
    // Every process of this run is gone by now, so a record still saying running is one whose
    // process died before it could end it: the sweep's to close first.
    if (card.status === 'running') throw new Error(`run ${opts.id} is still recorded running`)
    const previous = runnerMark(card)
    if (!previous) throw new Error(`run ${opts.id} is not this tool's`)
    const diary = (await readDiary(repo, opts.id, here.logs)) ?? []
    const sessionId = typeof card.caller?.['sessionId'] === 'string' ? (card.caller['sessionId'] as string) : undefined

    let prompt: string
    let resume: RunInput
    if (opts.answer !== undefined) {
      const question = [...diary].reverse().find(line => line.kind === 'question')
      const title = typeof question?.['title'] === 'string' ? (question['title'] as string) : 'your question'
      prompt = continuationPrompt(title, opts.answer)
      resume = { answer: opts.answer }
    } else if (opts.text) {
      // A run stopped before its agent took its own prompt never had it: it goes first, the words after it.
      prompt = card.intent !== undefined && !diary.some(line => line.kind === 'start') ? `${card.intent}\n\n${opts.text}` : opts.text
      resume = { text: opts.text, ...(opts.images !== undefined && opts.images.length > 0 ? { images: opts.images } : {}) }
    } else {
      throw new Error('a text or an answer is needed to resume a run')
    }

    // The level its record names, or the one this resume gives it from here on.
    const { publish: recorded, ...lasts } = lasting(previous)
    const publish = opts.publish === undefined ? recorded : (opts.publish ?? undefined)
    const mark: RunnerMark = { host: here.host, pid: here.pid, ...lasts, ...(publish !== undefined ? { publish } : {}), ...(opts.by !== undefined ? { resumed: { by: opts.by, at: here.clock() } } : {}) }
    const model = opts.model ?? card.model
    const effort = opts.effort ?? card.effort

    return runLeg(
      {
        repo,
        id: opts.id,
        here,
        driver: opts.driver,
        ...(model !== undefined ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
        prompt,
        ...(resume.images !== undefined ? { images: resume.images } : {}),
        earlier: { diary, ...(sessionId !== undefined ? { sessionId } : {}) },
        mark,
        card,
      },
      { modules: opts.modules, resume, facts: recordedFacts(card, previous), ...(opts.profileOptions ? { profile: opts.profileOptions } : {}) },
    )
  })
}

/** A distribution with no agent-driver has nothing to run a run's agent: refused before anything is written. */
function needsAgentDriver(modules: readonly DistributionEntry[]): void {
  if (!modules.some(entry => entry.module.name === 'agent-driver')) throw new Error("the run's distribution has no agent-driver module, which runs the agent")
}

/** What the run's record keeps of what its modules found out: where a resume starts from. */
function recordedFacts(card: RunCard, mark: RunnerMark): RunFacts {
  const earlier = earlierPrs(card)
  const branches = { ...(card.branch !== undefined ? { branch: card.branch } : {}), ...(mark.baseCommit !== undefined ? { baseCommit: mark.baseCommit } : {}) }
  const github = { ...(card.pr ? { pr: { number: card.pr.number, url: card.pr.url } } : {}), ...(earlier.length > 0 ? { earlierPrs: earlier } : {}) }
  return { ...(Object.keys(branches).length > 0 ? { 'git-branches': branches } : {}), ...(Object.keys(github).length > 0 ? { github } : {}) }
}

/**
 * The run's options, one slice per module, as the run was asked them and its record keeps them,
 * over its profile's: the plugins it goes without and the project's skills it gets, where the
 * session picked none. (Its accounts were the profile's already, where the session picked none:
 * the driver is made on them, and the account at the git host is the record's.)
 */
function optionsOf(mark: RunnerMark, branch: string | undefined, profile: ModuleOptions = {}): ModuleOptions {
  const branches = { ...(mark.base !== undefined ? { base: mark.base } : {}), ...(branch !== undefined ? { branch } : {}), ...(mark.repos !== undefined ? { repos: mark.repos } : {}) }
  const github = { ...(mark.prBase !== undefined ? { prBase: mark.prBase } : {}), ...(mark.gitAccount !== undefined ? { account: mark.gitAccount } : {}) }
  const without = mark.pluginsWithout ?? profile.plugins?.without
  const project = mark.projectSkills ?? profile.skills?.project
  return {
    ...(mark.publish !== undefined ? { publish: mark.publish } : {}),
    ...(Object.keys(branches).length > 0 ? { 'git-branches': branches } : {}),
    ...(Object.keys(github).length > 0 ? { github } : {}),
    ...(project !== undefined ? { skills: { project } } : {}),
    ...(without !== undefined ? { plugins: { without } } : {}),
    ...(mark.profile !== undefined ? { profiles: { profile: mark.profile } } : {}),
  }
}

/** The project a run in `dir` is in, as the hooks name it; none for a run in the sessions home, which has no project. */
export async function projectOf(dir: string, git: GitRunner): Promise<ProjectRef | undefined> {
  if ((await sessionsHomeOf(dir)) !== undefined) return undefined
  const remote = await repositoryAddress(dir, git)
  return { id: projectId(dir), name: await projectNameOf(dir, git), dir, ...(remote !== undefined ? { remote } : {}) }
}

/** What a leg starts from beside what agent-driver's steps share: the run's modules, and what the run brings them. */
interface LegStart {
  modules: readonly DistributionEntry[]
  /** What a resume brings; none for a fresh run. */
  resume?: RunInput
  /** What the run's modules found out on its earlier legs. */
  facts: RunFacts
  /** The branch a fresh run was told to work on (`run --branch`). */
  branch?: string
  /** The run options of the profile the run is on, as it stands at this leg. */
  profile?: ModuleOptions
}

/**
 * A leg of the run, through the steps of the run's modules in their order. A signal stops the run:
 * the first asks the agent to end its turn where it is, as Esc does in Claude Code, and the driver
 * ends its process tree only when it cannot ask or the agent does not stop; a second one ends the
 * tree at once. The handlers stay until this process is done, so a signal that comes while the run
 * records and reclaims never kills it halfway through a write. A finishing step that fails is said
 * on the log, and the others go on.
 */
async function runLeg(given: Omit<Leg, 'killed'>, start: LegStart): Promise<RunOutcome> {
  const stop = new AbortController()
  const kill = new AbortController()
  const leg: Leg = { ...given, killed: kill.signal }
  const onSignal = (): void => (stop.signal.aborted ? kill : stop).abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    const hooks = createHooks(start.modules)
    const project = await projectOf(leg.repo, leg.here.git)
    const options = optionsOf(leg.mark, start.branch, start.profile)
    // The skills the modules on for this run give it, for the agent it is on: the skills module links them where it works.
    const skills = await hooks.skills({ ...(project ? { project } : {}), agent: leg.driver, options })
    const ctx = withLeg(
      {
        id: leg.id,
        ...(project ? { project } : {}),
        // The run's first prompt, also on a resume: what continues it is the agent's (`leg.prompt`).
        prompt: leg.card.intent ?? leg.prompt,
        options,
        ...(start.resume ? { resume: start.resume } : {}),
        skills,
        context: [],
        env: {},
        facts: start.facts,
        signal: stop.signal,
        store: hooks.store,
        settings: hooks.settings,
      },
      leg,
    )
    const { outcome, errors } = await hooks.run(ctx)
    for (const { module, step, error } of errors) leg.here.log(`[agent-runner] ${module} could not ${step}: ${errorMessage(error)}`)
    const { branch, reclaimed } = ctx.facts['git-branches'] ?? {}
    const pr = ctx.facts.github?.pr
    const cost = leg.recorded?.card.cost
    const detail = detailOf(outcome)
    return {
      id: leg.id,
      status: outcome.status,
      ...(branch !== undefined ? { branch } : {}),
      ...(pr ? { pr } : {}),
      ...(cost !== undefined ? { cost } : {}),
      checkout: reclaimed === undefined ? { reclaimed: false, reason: 'no checkout' } : reclaimed.reclaimed ? { reclaimed: true } : { reclaimed: false, reason: reclaimed.reason },
      ...(detail !== undefined ? { detail } : {}),
    }
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    // The run's environment was this process's for the leg alone.
    leg.leaveEnvironment?.()
  }
}

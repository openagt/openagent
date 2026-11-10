import { hostname } from 'node:os'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentExitError, ConversationGoneError, continuationPrompt, logDiaryFile, parseQuestion, promptLines, promptOf, takeInbox, type Driver, type DriverPromptOptions, type DriverSession, type DriverTurn, type PromptLine, type LogEndStatus, type Question, type SessionLog } from '@openagt/agent-driver'
import { errorMessage, nodeGitRunner, sessionsHomeOf, type GitRunner } from '@openagt/agent-data'
import { agentBranchName, attachCheckout, createCheckout, reclaimWorktree, relinkCheckout, worktreeBranch, worktreePath, type SkillLink, type LeaveOut } from '@openagt/skill-branches'
import { findRun, readDiary, type AnyDiaryLine, type LogsDeps, type RunCard, type RunStatus } from '@openagt/skill-logs'
import { hideLiveDir, inboxPath, liveDir, readLiveCard, readLiveDiary } from './live-card.js'
import { earlierPrs, forReaders, lasting, markerCard, publishChange, recordBranchGone, recordRun, runnerMark, startOf, writeMarker, type Publish, type RunnerMark, type SessionRepo } from './records.js'
import { projectGitHost, type BranchRequest, type GitHost } from './git-host.js'
import { basicSkills } from './basic-skills.js'
import { leavingOut } from './project-skills.js'
import type { ProjectSkillsPick } from './agent.js'
import { isPidAlive, withRunLock } from './run-lock.js'
import { runEndedLine } from './ended.js'
import { askName, isBareCommand, nameRun, type AskedName } from './title.js'
import { childEndedLine, tellParent, type ParentDeps } from './parent.js'
import { openSessionFolder, SESSION_FOLDER_STAYS } from './session-folder.js'

/**
 * One run (#1774): a checkout from the branches package, a session from agent-driver, the prompt
 * once, and the agent's own loop to the end. No system prompt and no gates: the
 * command's skill file is the whole instruction, and the agent publishes its own work, when asked
 * to, through the skills in its checkout. How far it takes its work is the run's publish level
 * (`run --publish <commit|branch|pr|merge>`), said in one sentence after the prompt: commit the work,
 * and from there push the branch, open its pull request, or set it to merge once its checks pass.
 * The sentence follows every message the agent is sent, a queued one too, and the record keeps it
 * apart from the message. A run with no level gets its prompt as written, and its agent commits
 * only when the prompt asks.
 * This process records the run and reclaims the checkout when the
 * agent stops; a run that dies is caught by the sweep, which a scheduler runs on every tick.
 *
 * The session keeps the run's live record itself, the card and the diary under `.openagent/`
 * in the checkout, in the run record's shape; this process adds its mark, the pid and the host,
 * and copies the two files onto the branch unchanged when the run ends. What reaches the agent
 * from outside comes through the session's inbox: a message written while a turn runs reaches the
 * agent at its next step, and a line still waiting when a turn ends becomes the next turn; when the
 * last turn ended on a question and nothing waited, the run ends `waiting`, keeps its checkout, and
 * the answer resumes it (`resumeRun`): the same run, the same record, continued.
 *
 * SIGINT or SIGTERM to this process stops the run: the agent is asked to end its turn where it is,
 * its conversation keeps everything up to there, the run is recorded `stopped`, and the checkout is
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
 * A run may be started for another run, its parent (`run --parent <id>`), from a branch other
 * than origin's default (`run --base <ref>`), and with its pull request going into one
 * (`run --pr-base <branch>`); all are on its record for its whole life. When it
 * ends, however it ends, its parent is told (`parent.ts`).
 *
 * A run started in the sessions home has no project: it works in a folder of its own there
 * (`session-folder.ts`), with no branch, no pull request and nothing to reclaim, and its record is
 * kept with the other sessions' (`@openagt/agent-data`'s sessions).
 *
 * A run that makes its own branch writes down the commit the branch was made at, on its record
 * for its whole life: the run's own work is what came after it, which is how it is still told
 * apart once it is merged. A run given a branch that exists (a person's pull request's) writes none: that
 * branch's work began with another run.
 */

/** How long naming a run from its report may hold its end up: the small model answers in a few seconds. */
const REPORT_NAMING_TIMEOUT_MS = 15_000

/** The detail a stopped run's record carries. */
export const STOPPED_DETAIL = 'stopped by a signal to its process'

const COMMIT_OPENING = 'When you finish, if you changed any file, commit your work'
const PUBLISH_OPENING = `${COMMIT_OPENING}, push your branch`

/** The sentence after a prompt that says how far to take the work, every level starting with the commit; how is the business of the skills in the checkout. */
export const PUBLISH_LINES: Readonly<Record<Publish, string>> = {
  commit: `${COMMIT_OPENING}.`,
  branch: `${PUBLISH_OPENING} and open no pull request.`,
  pr: `${PUBLISH_OPENING} and open its pull request.`,
  merge: `${PUBLISH_OPENING} and open its pull request, set to merge on its own once its checks pass.`,
}

const OPENS_REQUEST = 'open its pull request'

/**
 * The sentence a run adds after every prompt of its agent, the first and each message after it:
 * that of its publish level, none for a run with none, naming the branch its pull request goes
 * into at a level that opens one. The session sends it after the prompt and writes it down apart
 * from it, so a reader shows the person's words as the person wrote them.
 */
export function addedLine(publish: Publish | undefined, prBase?: string): string | undefined {
  if (publish === undefined) return undefined
  return prBase !== undefined ? PUBLISH_LINES[publish].replace(OPENS_REQUEST, `${OPENS_REQUEST} into the branch ${prBase}`) : PUBLISH_LINES[publish]
}

/** The sentence as a session takes it: named, or left out. */
function addedOf(publish: Publish | undefined, prBase: string | undefined): { added?: string } {
  const added = addedLine(publish, prBase)
  return added !== undefined ? { added } : {}
}

/** Filesystem-safe, time-ordered id from an ISO start: the shape the dashboard sorts runs by. */
export function runIdFrom(startedAt: string): string {
  return startedAt.replace(/[:.]/g, '-')
}

/** The model as a card or a session takes it: named, or left out so the tool starts on its own default. */
function modelOf(model: string | undefined): { model?: string } {
  return model !== undefined ? { model } : {}
}

/** How hard the model may think, the same way: named, or left out so the tool thinks as it does by default. */
function effortOf(effort: string | undefined): { effort?: string } {
  return effort !== undefined ? { effort } : {}
}

/**
 * This run's card with what only the tool that marked it knew: every field of the marker this
 * process did not build itself, and the same for the writer's own `caller` keys. Orchestration's
 * `title` (the task's name) and its task id come through this way, and so does whatever a later
 * tool writes there — the rule a card is read and written by, that a writer keeps the fields it
 * does not know (#2104), applied to a run writing its own record.
 *
 * What this process does know wins: it is running, so its status, its branch, its checkout and its
 * pid are the true ones, and a stale marker never speaks over them.
 */
function carried(marked: RunCard | undefined, card: RunCard): RunCard {
  if (marked === undefined) return card
  const theirs = Object.fromEntries(Object.entries(marked).filter(([key]) => !(key in card)))
  const caller = Object.fromEntries(Object.entries(marked.caller ?? {}).filter(([key]) => !(key in (card.caller ?? {}))))
  return { ...theirs, ...card, ...(Object.keys(caller).length > 0 ? { caller: { ...caller, ...card.caller } } : {}) }
}

/**
 * What a run's process is handed beside what the run is asked, the same for a fresh run and a
 * continued one: the coding agent, and every dependency a test may stand in for, the real one when absent.
 */
export interface RunDeps {
  driver: Driver
  /** How an ended parent is continued, in its own process; absent, only a working parent is told. */
  resume?: ParentDeps['resume']
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
interface RunProcess {
  host: string
  pid: number
  isAlive: (pid: number) => boolean
  git: GitRunner
  gitHost: GitHost
  clock: () => string
  logs: LogsDeps
  log: (line: string) => void
  /** What telling the run's parent needs, when its record names one. */
  telling: ParentDeps
}

function runProcess(deps: RunDeps): RunProcess {
  const now = deps.now ?? (() => new Date())
  const host = deps.host ?? hostname()
  const isAlive = deps.isAlive ?? isPidAlive
  const log = deps.log ?? (() => {})
  return {
    host,
    pid: deps.pid ?? process.pid,
    isAlive,
    git: deps.git ?? nodeGitRunner(),
    gitHost: deps.gitHost ?? projectGitHost,
    clock: () => now().toISOString(),
    logs: deps.logs ?? {},
    log,
    telling: { host, isAlive, ...(deps.resume ? { resume: deps.resume } : {}), log },
  }
}

/** The skills a run links into its checkout, for its coding agent; none when they cannot be read. */
function linkedSkills(repo: string, deps: RunDeps): Promise<readonly SkillLink[]> {
  return (deps.skills ?? basicSkills)(repo, deps.driver).catch((): SkillLink[] => [])
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
  /** The run this one is started for (`run --parent`): told when this one ends. */
  parent?: string
  /** The branch the run's fresh branch starts from (`run --base`); origin's default branch when absent. */
  base?: string
  /** The branch the run's pull request goes into (`run --pr-base`); the repository's default branch when absent. */
  prBase?: string
  /** The branch to work on (`run --branch`), one that exists, such as a person's pull request's; a fresh `agent-<id>` when absent. */
  branch?: string
  /** What the run is started for (`run --for`), kept on its mark: a thread on the git host, by its address. */
  for?: string
  /** The repos a session with no project has as context (`run --repos`), each copied into its folder; kept on its mark. */
  repos?: SessionRepo[]
}

export interface RunOptions extends RunRequest, RunDeps {
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
  /** The account the run works as at the git host, kept on its record; none when the git host cannot say. */
  gitAccount?: string
  /** The agent the run is on, by its id (`OPENAGENT_AGENT`), kept on its mark; the default agent when absent. */
  agent?: string
  /** The session's picks of skills, kept on its mark (`agent.ts` SkillPicks): skills on top of its agent's, skills of its agent's left out, which of the project's own stay in its checkout. */
  skillsOn?: string[]
  skillsOff?: string[]
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
 * Whether a run is named the moment it starts: not a subagent, whose row is its task, not a run
 * another tool marked, whose marker may carry its name, nor a bare command, named from its report
 * (`title.ts`); and not when the person turned naming off (`OPENAGENT_NAME_RUN=0`).
 */
export function namedAtStart(opts: { prompt: string; marked?: boolean; parent?: string }): boolean {
  return process.env.OPENAGENT_NAME_RUN !== '0' && !opts.marked && opts.parent === undefined && !isBareCommand(opts.prompt)
}

export async function runCommand(repo: string, opts: RunOptions): Promise<RunOutcome> {
  const here = runProcess(opts)
  const startedAt = opts.startedAt ?? here.clock()
  const id = opts.id ?? runIdFrom(startedAt)
  let mark: RunnerMark = { host: here.host, pid: here.pid, ...lasting(opts) }

  return withRunLock(repo, id, here, async () => {
    // A person's run marks itself; a scheduler's run was marked before it was spawned. The marker
    // is pushed while the checkout is made and the agent starts: pushing takes seconds, and the
    // person watching the run waits on the agent. It never writes `.git/config`, so the agent's own
    // git is never locked out by it. The run's record waits on it, so it lands after.
    const marker = markerCard({ id, startedAt, prompt: opts.prompt, driver: opts.driver.id, ...modelOf(opts.model), mark })
    const marking = opts.marked
      ? Promise.resolve()
      : writeMarker(repo, marker, here.logs).then(
          marked => {
            if (!marked.ok && !marked.committed) here.log(`[agent-runner] the run's record could not be written: ${marked.error}`)
          },
          err => here.log(`[agent-runner] the run's record could not be written: ${errorMessage(err)}`),
        )

    // The run's short name is asked for first of all, beside the checkout and the agent's start
    // rather than after them: the name is the first thing a person watching the run waits on, and
    // asking takes seconds of its own (`title.ts`). Earlier still when whoever starts the run asked
    // already (`runProject`, before the git host's account is read), and only for a run that is
    // named at start ({@link namedAtStart}).
    const naming = opts.naming ?? (namedAtStart(opts) ? askName(opts.driver, opts.prompt) : undefined)

    // The checkout: the branches package's one sequence, on a fresh branch or the one given.
    // Without one there is no run, and the record says so instead of a marker left running.
    let checkout: Workspace
    const sessions = await sessionsHomeOf(repo)
    try {
      const skills = await linkedSkills(repo, opts)
      // The project's own skills the session leaves out stay out of this checkout alone.
      const without = leavingOut(mark.projectSkills, here.git)
      checkout =
        sessions !== undefined
          ? await openSessionFolder(sessions, id, skills, mark.repos, here.git)
          : opts.branch !== undefined
            ? await attachCheckout(repo, { agentId: id, branch: opts.branch, skills, without }, here.git)
            : await createCheckout(repo, { agentId: id, skills, without, ...(opts.base !== undefined ? { base: opts.base } : {}) }, here.git)
    } catch (err) {
      naming?.stop.abort()
      const detail = `could not create a checkout: ${errorMessage(err)}`
      const endedAt = here.clock()
      await marking
      await recordRun(repo, { ...marker, status: 'failed', endedAt }, [{ kind: 'ended', status: 'failed', detail, at: endedAt }], here.logs)
      if (opts.parent !== undefined) await tellParent(repo, opts.parent, childEndedLine({ id, status: 'failed', detail }), here.telling)
      return { id, status: 'failed', checkout: { reclaimed: false, reason: 'no checkout' }, detail }
    }
    // Only a branch this run made: one it was given holds another run's work, begun elsewhere.
    if (checkout.branch !== undefined && opts.branch === undefined) mark = { ...mark, ...(await startCommit(checkout.path, here.git)) }
    // A run another tool marked carries what only that tool knows: orchestration writes the task's
    // name as the run's `title` and the task's id under `caller`. This process builds its card from
    // its own arguments, which never held either, and that card seeds the live card the record is
    // written from at the end — so without reading the marker back, a run loses those fields the
    // moment it ends, which is when a person and the tool that started it read them.
    const marked = opts.marked ? await findRun(repo, id).catch(() => undefined) : undefined
    return session(repo, {
      ...here,
      id,
      checkout,
      card: carried(marked, {
        id,
        startedAt,
        status: 'running',
        intent: opts.prompt,
        driver: opts.driver.id,
        ...modelOf(opts.model),
        ...effortOf(opts.effort),
        ...(checkout.branch !== undefined ? { branch: checkout.branch } : {}),
        caller: { runner: mark, pid: here.pid, host: here.host, ...forReaders(mark), kind: 'prompt', workspace: checkout.path },
      }),
      prompt: opts.prompt,
      ...(opts.attached !== undefined ? { attached: opts.attached } : {}),
      ...addedOf(opts.publish, opts.prBase),
      driver: opts.driver,
      ...modelOf(opts.model),
      ...effortOf(opts.effort),
      ...(naming !== undefined ? { named: naming } : {}),
      continued: false,
      marking,
    })
  })
}

export interface ResumeOptions extends RunDeps {
  /** The run to continue: one that ended `waiting`, or any ended run whose session the driver can resume. */
  id: string
  /** The user's words to the agent; or, with `answer`, absent. */
  text?: string
  /** The chosen label or labels, answering the question the run's last turn asked. */
  answer?: string
  /** How far the run takes its work from here on: a level, or `null` for none; the level its record names when absent. */
  publish?: Publish | null
  /** The account this leg works as at the git host, on the record from here on; the record's own when absent. */
  gitAccount?: string
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
    if (opts.answer !== undefined) {
      const question = [...diary].reverse().find(line => line.kind === 'question')
      const title = typeof question?.['title'] === 'string' ? (question['title'] as string) : 'your question'
      prompt = continuationPrompt(title, opts.answer)
    } else if (opts.text) {
      prompt = opts.text
    } else {
      throw new Error('a text or an answer is needed to resume a run')
    }

    const skills = await linkedSkills(repo, opts)
    const sessions = await sessionsHomeOf(repo)
    // A session's folder is opened again as it is, and made again when someone removed it.
    const checkout: Workspace & { again?: true } = sessions !== undefined ? await openSessionFolder(sessions, opts.id, skills, previous.repos, here.git) : await projectCheckout(repo, opts.id, card.branch, previous.base, skills, leavingOut(previous.projectSkills, here.git), here.git)
    // A branch that was gone everywhere was just made again, from where it starts as that is now:
    // that is where the run's own work begins. One still on origin came back with its work.
    const restarted = checkout.again ? await startCommit(checkout.path, here.git) : {}

    // The record is written running again over the ended one, so every reader sees the run in flight.
    // The level its record names, or the one this resume gives it from here on.
    const { publish: recorded, ...lasts } = lasting(previous)
    const publish = opts.publish === undefined ? recorded : (opts.publish ?? undefined)
    const mark: RunnerMark = { host: here.host, pid: here.pid, ...lasts, ...(publish !== undefined ? { publish } : {}), ...(opts.gitAccount !== undefined ? { gitAccount: opts.gitAccount } : {}), ...restarted, ...(opts.by !== undefined ? { resumed: { by: opts.by, at: here.clock() } } : {}) }
    const runningCard: RunCard = { ...card, status: 'running', caller: { ...card.caller, runner: mark, pid: here.pid, host: here.host, ...forReaders(mark), workspace: checkout.path } }
    delete runningCard.endedAt
    // A level taken away by this resume is no longer the run's, for its readers either.
    if (mark.publish === undefined) delete runningCard.caller?.['publish']
    // A record that says its work was landed lost its branch to that. On a branch made again the
    // work is new and not landed: left on the record, every reader would go on saying it is.
    if (checkout.again) delete runningCard.caller?.['landed']
    const reopened = await recordRun(repo, runningCard, diary, here.logs)
    if (!reopened.ok && !reopened.committed) here.log(`[agent-runner] the run's record could not be written: ${reopened.error}`)

    return session(repo, {
      ...here,
      id: opts.id,
      checkout,
      card: { ...runningCard },
      priorDiary: diary,
      prompt,
      ...addedOf(mark.publish, mark.prBase),
      driver: opts.driver,
      ...modelOf(opts.model ?? card.model),
      ...effortOf(opts.effort ?? card.effort),
      continued: true,
      ...(sessionId !== undefined ? { resumeSessionId: sessionId } : {}),
    })
  })
}

/** Where a run works: a checkout of the project on its branch, or a session's own folder, which has no branch. */
interface Workspace {
  path: string
  branch?: string
}

/**
 * A continued run's checkout: the one it kept, or a new one attached to its branch; a branch that
 * went with the checkout, for holding nothing, starts again from `base`, or origin's default branch.
 */
async function projectCheckout(repo: string, id: string, branch: string | undefined, base: string | undefined, skills: readonly SkillLink[], without: LeaveOut, git: GitRunner): Promise<{ path: string; branch: string; again?: true }> {
  const on = branch ?? agentBranchName(id)
  const path = worktreePath(repo, id)
  if (!(await stat(path).then(s => s.isDirectory(), () => false))) return attachCheckout(repo, { agentId: id, branch: on, skills, without, ...(base !== undefined ? { base } : {}) }, git)
  // A checkout that stayed was made by whatever version ran then: its links are brought to what a new one gets.
  await relinkCheckout(repo, path, { skills, without }, git)
  return { path, branch: on }
}

interface SessionRun extends RunProcess {
  id: string
  checkout: Workspace
  card: RunCard
  /** The diary the record already holds, for a continued run: written into the checkout before the session opens. */
  priorDiary?: AnyDiaryLine[]
  prompt: string
  /** The sentence said after the prompt and after every message that follows it in this session. */
  added?: string
  /** The text handed over with the prompt, and with no message after it. */
  attached?: string
  driver: Driver
  model?: string
  /** How hard the model may think this session. */
  effort?: string
  continued: boolean
  /** The run's name, asked for as the run began (`runCommand`); stopped when the run is. */
  named?: AskedName
  /** The run's own marker being pushed, when it writes one: the record waits on it, so it lands after. */
  marking?: Promise<void>
  resumeSessionId?: string
}

/** A prompt this process owes the agent, and the level a message taken from the inbox after the run's last turn gave the run with it. */
interface Queued {
  prompt: string
  publish?: string
}

/** An inbox line as the prompt it becomes, with the level its message carries. */
function queued(line: PromptLine): Queued {
  return { prompt: promptOf(line), ...(line.kind === 'message' && line.publish !== undefined ? { publish: line.publish } : {}) }
}

/** The session, its end, the record and the reclaim: the part a fresh run and a continued one share. */
async function session(repo: string, run: SessionRun): Promise<RunOutcome> {
  const dir = liveDir(run.checkout.path)
  if (run.priorDiary) {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, logDiaryFile(run.id)), run.priorDiary.map(line => JSON.stringify(line) + '\n').join(''))
  }
  // A checkout with an untracked directory in it is a dirty tree, which the branches rule never reclaims.
  await hideLiveDir(run.checkout.path).catch(() => {})

  // A signal stops the run: the first asks the agent to end its turn where it is, as Esc does in
  // Claude Code, and the driver ends its process tree only when it cannot ask or the agent does not
  // stop; a second one ends the tree at once. The handlers stay until this process is done, so a
  // signal that comes while the run records and reclaims never kills it halfway through a write.
  const stop = new AbortController()
  const kill = new AbortController()
  const onSignal = (): void => (stop.signal.aborted ? kill : stop).abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    return await closeRun(repo, run, await sessionToEnd(repo, run, dir, stop.signal, kill.signal))
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

/** How a session ended: what the run's record, its parent and the reclaim of its checkout go by. */
interface SessionEnd {
  status: LogEndStatus
  detail: string | undefined
  /** The question the last turn asked, when the run ended waiting. */
  question: string | undefined
  /** The branch the agent left its work on, and the pull request read back off it. */
  branch: string | undefined
  pr: BranchRequest | undefined
  /** The requests the run opened before the one its card names, once it has had any. */
  earlierPrs: BranchRequest[] | undefined
  /** The agent's answer on its last turn. */
  lastWords: string
  /** The live record the session kept; none when its agent never started. */
  live: SessionLog | undefined
}

/** The agent's session, from its start to the end of the last turn this process owes it. */
async function sessionToEnd(repo: string, run: SessionRun, dir: string, stopped: AbortSignal, killed: AbortSignal): Promise<SessionEnd> {
  const { id: _id, status: _status, endedAt: _endedAt, ...startCard } = run.card
  const inbox = inboxPath(run.checkout.path)
  let status: LogEndStatus = 'done'
  let detail: string | undefined
  let branch = run.checkout.branch
  let pr: BranchRequest | undefined
  // The request the card names, and the ones the run opened before it: a turn that opens another,
  // on a branch the work moved to, puts the one before it among the earlier ones.
  let named = run.card.pr
  let earlier = earlierPrs(run.card)
  let saidEarlier = earlier.length > 0
  let question: string | undefined
  let lastWords = ''
  let driverSession: DriverSession | undefined
  try {
    driverSession = await run.driver.start({
      cwd: run.checkout.path,
      ...modelOf(run.model),
      ...effortOf(run.effort),
      signal: killed,
      stop: stopped,
      ...(run.resumeSessionId !== undefined ? { resumeSessionId: run.resumeSessionId } : {}),
      log: { dir, card: { id: run.id, ...startCard }, continue: run.continued },
    })
  } catch (err) {
    status = 'failed'
    detail = errorMessage(err)
  }
  const naming = nameSession(run, driverSession, stopped)
  const level = publishLevel(run, driverSession)
  try {
    // The prompts this process owes the agent: the run's own, then the lines that reached the
    // inbox after the last turn took it but while the card still said running. Whoever wrote
    // them was told the run has them, so this process sends them before it lets the run go.
    let queue: Queued[] = [{ prompt: run.prompt }]
    let resume = run.continued
    // A continued run whose record names no conversation has none to go on with: it starts afresh.
    let fresh = run.continued && run.resumeSessionId === undefined
    // Handed over with the run's own prompt only: the first one this process sends.
    let attached = run.attached
    while (driverSession) {
      status = 'done'
      detail = undefined
      question = undefined
      let failure: unknown
      let lastText = ''
      let asked: Question | undefined
      try {
        for (const [i, { prompt, publish }] of queue.entries()) {
          // Stopped between two prompts: the rest are not sent.
          if (stopped.aborted) break
          await level.take(publish)
          // Only the last one drains the inbox: a line written meanwhile comes after these.
          const last = i === queue.length - 1
          const handed = attached
          attached = undefined
          const sent = { ...(last ? { inbox, onInboxLine: level.onInboxLine } : {}), ...(resume ? { resume: true } : {}), ...(handed !== undefined ? { attached: handed } : {}), ...level.added() }
          const session = driverSession
          const turn = fresh
            ? await afresh(session, run, prompt, sent)
            : await session.prompt(prompt, sent).catch((err: unknown) => {
                if (err instanceof ConversationGoneError) return afresh(session, run, prompt, sent)
                throw err
              })
          fresh = false
          lastText = turn.text
          asked = turn.question
          lastWords = turn.text
          resume = true
        }
      } catch (err) {
        status = 'failed'
        detail = errorMessage(err)
        failure = err
      }
      if (stopped.aborted) {
        status = 'stopped'
        detail = STOPPED_DETAIL
      } else if (status === 'done') {
        // The last turn asked and nothing waited in the inbox: the run ends here, waiting, and
        // keeps its checkout for the answer to resume it.
        question = (asked ?? parseQuestion(lastText))?.title
        if (question !== undefined) status = 'waiting'
      }
      await naming.fromReport(status, lastText)

      // Where the work ended up: the agent renames its branch itself, and the pull request it
      // opened, if any, is read back off the branch through the project's git host.
      // A session's folder has no branch, and so no pull request.
      if (run.checkout.branch !== undefined) {
        branch = (await worktreeBranch(run.checkout.path, run.git).catch(() => undefined)) ?? run.checkout.branch
        pr = await run.gitHost.requestOfBranch(repo, branch).catch(() => undefined)
      }
      if (pr && named && pr.url !== named.url) earlier = [...earlier, { number: named.number, url: named.url }]
      if (pr) named = pr
      // Each once, and never the one the card names: work moved back to a branch takes its request back.
      earlier = earlier.filter((one, at) => one.url !== named?.url && earlier.findIndex(other => other.url === one.url) === at)
      const live = driverSession.log
      if (!live) break
      // Written whenever the run has had one, so a list emptied by the work moving back is said too.
      saidEarlier ||= earlier.length > 0
      await live.patch({ ...(branch !== undefined ? { branch } : {}), ...(pr ? { pr } : {}), ...(saidEarlier ? { caller: { earlierPrs: earlier } } : {}) })
      // The ended line leaves out a reason the diary already holds: the agent's error line, written
      // just before its process exited, says it, so the ended line says only that the agent exited.
      await live.end(status, status === 'failed' && failure instanceof AgentExitError ? failure.exit : detail)
      await live.settled()

      // The card says ended now, so a line written from here on goes to the project's resume
      // hook, which waits for this process. What is in the inbox was written before: this
      // process's to send. A stopped run was stopped on purpose; what reached it is dropped.
      if (status === 'stopped' || stopped.aborted) break
      queue = promptLines(await takeInbox(inbox)).map(queued)
      if (queue.length === 0) break
      await live.reopen()
    }
  } finally {
    await driverSession?.dispose().catch(() => {})
  }

  // The name lands on the card before the record is copied: a run named after that copy would be
  // named only in its checkout, which is removed with the run.
  await naming.done
  return { status, detail, question, branch, pr, earlierPrs: saidEarlier ? earlier : undefined, lastWords, live: driverSession?.log }
}

/**
 * The run's short name, asked of a small model beside the first turn (`title.ts`), or as the run
 * began, before its checkout was made, when it was a fresh one no other tool marked (`runCommand`):
 * a run that is being continued was named when it began, and one whose agent never started has
 * nothing to name. A subagent is not named: its row is its task, written by the agent that started
 * it, and an orchestration of a dozen of them would pay for a dozen namings for rows nobody looks
 * for. `OPENAGENT_NAME_RUN=0` is the person's setting, put in this process's environment by whoever
 * started it: naming costs money for something only a person looks at, so it can be declined.
 * A bare command is named later, from its agent's report (`fromReport`).
 */
function nameSession(run: SessionRun, session: DriverSession | undefined, stopped: AbortSignal): { done: Promise<void>; fromReport(status: LogEndStatus, report: string): Promise<void> } {
  const mayName = process.env.OPENAGENT_NAME_RUN !== '0' && session !== undefined && !run.continued && run.card.title === undefined && runnerMark(run.card)?.parent === undefined
  let fromReport = mayName && isBareCommand(run.prompt)
  // A fresh run's name was asked for as the run began (`runCommand`): it is dropped when the run will
  // not take it, and stopped with the run.
  const asked = run.named
  if (asked && (!mayName || stopped.aborted)) asked.stop.abort()
  else if (asked) stopped.addEventListener('abort', () => asked.stop.abort(), { once: true })
  const titled = async (title: string | undefined): Promise<void> => {
    if (title !== undefined) await session?.log?.title(title)
  }
  return {
    done: mayName && !fromReport ? (asked?.title ?? nameRun(run.driver, { prompt: run.prompt, signal: stopped })).then(titled, () => {}) : Promise.resolve(),
    // Named from its first report once its status is settled, before it is said ended, so the
    // name's line in the diary comes before the ended one; a stop meanwhile only cuts the naming
    // short. A question is no report of the work, and a few seconds is all a name may hold the
    // end up.
    async fromReport(status, report) {
      if (!fromReport || status !== 'done' || report.trim() === '') return
      fromReport = false
      await titled(await nameRun(run.driver, { prompt: report, from: 'report', signal: stopped, timeoutMs: REPORT_NAMING_TIMEOUT_MS }))
    },
  }
}

/**
 * The sentence after every prompt, and the mark that keeps the level it says: a message can change
 * the level from there on (`publish` on its inbox line, or on a line queued after the last turn),
 * and the record says so then.
 */
function publishLevel(run: SessionRun, session: DriverSession | undefined): { added(): { added?: string }; take(word: string | undefined): Promise<void>; onInboxLine(line: PromptLine, sent: DriverPromptOptions): Promise<DriverPromptOptions> } {
  let added = run.added
  let mark = runnerMark(run.card)
  const take = async (word: string | undefined): Promise<void> => {
    const level = publishChange(word)
    if (level === undefined || !mark) return
    const { publish: _was, ...rest } = mark
    mark = { ...rest, ...(level !== null ? { publish: level } : {}) }
    added = addedLine(mark.publish, mark.prBase)
    await session?.log?.patch({ caller: { runner: mark, publish: mark.publish } })
  }
  return {
    added: () => (added !== undefined ? { added } : {}),
    take,
    // A line the driver takes from the inbox is handed here first: a message may say how far the run
    // takes its work from it on, and every line goes with the sentence in force now, which a line
    // handed over in a later turn may have changed.
    onInboxLine: async (line, sent) => {
      if (line.kind === 'message') await take(line.publish)
      const { added: _was, ...rest } = sent
      return added !== undefined ? { ...rest, added } : rest
    },
  }
}

/**
 * What follows the session: the run's record written from what the session kept, the person's line
 * when this end needs them, the run's parent told how it ended, and its checkout reclaimed.
 */
async function closeRun(repo: string, run: SessionRun, end: SessionEnd): Promise<RunOutcome> {
  const { status, detail, question, branch, pr, live } = end
  // The record: the two files the session kept, copied onto the branch unchanged. A session that
  // kept none never started: a card in a checkout kept from an earlier leg says how that leg ended.
  const card = (live ? await readLiveCard(run.checkout.path, run.id) : undefined) ?? { ...run.card, status, endedAt: run.clock(), ...(branch !== undefined ? { branch } : {}), ...(pr ? { pr } : {}), ...(end.earlierPrs ? { caller: { ...run.card.caller, earlierPrs: end.earlierPrs } } : {}) }
  const diary = live ? await readLiveDiary(run.checkout.path, run.id) : [...(run.priorDiary ?? []), { kind: 'ended', status, ...(detail !== undefined ? { detail } : {}), at: card.endedAt ?? run.clock() }]
  await run.marking
  const recorded = await recordRun(repo, card, diary, run.logs)
  if (!recorded.ok && !recorded.committed) run.log(`[agent-runner] the run's record could not be written: ${recorded.error}`)

  // The person's line, when this end needs them: a question, or a pull request new to this session.
  await runEndedLine(repo, { id: run.id, prompt: run.card.intent ?? '', status, ...(question !== undefined ? { question } : {}), ...(pr ? { pr } : {}), ...(run.card.pr ? { prBefore: run.card.pr } : {}) }, { log: run.log })

  // The run's parent, when it has one, is told how it ended, once the branch it would be pointed
  // at is known to have stayed: an empty one goes with the checkout.
  const parent = runnerMark(run.card)?.parent
  const tell = async (branchStayed: boolean): Promise<void> => {
    if (parent === undefined) return
    const line = childEndedLine({ id: run.id, status, ...(detail !== undefined ? { detail } : {}), ...(question !== undefined ? { question } : {}), ...(branchStayed && branch !== undefined ? { branch } : {}), ...(pr ? { pr } : {}), lastWords: end.lastWords })
    await tellParent(repo, parent, line, run.telling)
  }
  const outcome = (checkout: RunOutcome['checkout']): RunOutcome => ({
    id: run.id,
    status,
    ...(branch !== undefined ? { branch } : {}),
    ...(pr ? { pr } : {}),
    ...(card.cost !== undefined ? { cost: card.cost } : {}),
    checkout,
    ...(detail !== undefined ? { detail } : {}),
  })

  // The checkout goes once its branch holds everything in it (the branches rule), and the branch
  // stays on this machine: nothing is pushed here, publishing is the agent's when it was asked, the person's otherwise. A dirty tree
  // keeps the checkout, and the sweep tries again later. A waiting run keeps it on purpose: the
  // answer resumes the run there.
  if (status === 'waiting') {
    await tell(true)
    return outcome({ reclaimed: false, reason: 'waiting' })
  }
  // A session's folder is its work, kept for the person and for the run going on later.
  if (branch === undefined) {
    await tell(false)
    return outcome({ reclaimed: false, reason: SESSION_FOLDER_STAYS })
  }
  const reclaimed = await reclaimWorktree(repo, run.checkout.path, { birthBranch: agentBranchName(run.id), ...startOf(run.card), git: run.git })
  if (reclaimed.ok) {
    const rewritten = await recordBranchGone(repo, card, diary, reclaimed.branchesDeleted, run.logs)
    if (rewritten && !rewritten.ok && !rewritten.committed) run.log(`[agent-runner] the run's record could not be written: ${rewritten.error}`)
  }
  await tell(!(reclaimed.ok && reclaimed.branchesDeleted?.includes(branch)))
  return outcome(reclaimed.ok ? { reclaimed: true } : { reclaimed: false, reason: reclaimed.reason })
}

/** The line a continued run's record gets where its coding agent starts a fresh conversation. */
export const AFRESH_NOTICE = "The coding agent no longer has this run's earlier conversation: a fresh one starts here, told to read this run's record first."

/** What the agent of a run going on in a fresh conversation is handed after its prompt: where its earlier work is. */
export function earlierWorkLine(id: string, pr: { url: string } | undefined): string {
  return `Your earlier conversation in this run is gone, so this one starts without it. Before anything else, read what you did before: this run's record, \`npx @openagt/skill-logs@0.1 show ${id}\`${pr ? `, and the whole thread of its pull request, ${pr.url}` : ''}.`
}

/**
 * A continued run's prompt in a fresh conversation (#2042): its agent no longer has the one the
 * record names, or the record names none. The run stays the same run, its record and branch, and
 * its record says where the fresh conversation starts; the agent reads its own record first, the
 * diary that kept what it said, which outlives the agent's own copy of the conversation.
 */
async function afresh(session: DriverSession, run: SessionRun, prompt: string, sent: DriverPromptOptions): Promise<DriverTurn> {
  await session.log?.record({ type: 'notice', message: AFRESH_NOTICE })
  return session.prompt(prompt, { ...sent, resume: false, attached: earlierWorkLine(run.id, run.card.pr) })
}

/** The commit a checkout just made is at: where the run's own work begins. Nothing when git cannot say. */
async function startCommit(checkout: string, git: GitRunner): Promise<{ baseCommit?: string }> {
  const commit = (await git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], checkout).catch(() => '')).trim()
  return commit ? { baseCommit: commit } : {}
}

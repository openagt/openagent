import { hostname } from 'node:os'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentExitError, ConversationGoneError, continuationPrompt, logDiaryFile, parseQuestion, promptOf, takeInbox, type Driver, type DriverPromptOptions, type DriverSession, type DriverTurn, type InboxLine, type LogEndStatus } from '@openagt/agent-driver'
import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { agentBranchName, attachCheckout, createCheckout, reclaimWorktree, relinkCheckout, worktreeBranch, worktreePath, type SkillLink } from '@openagt/skill-branches'
import { findRun, readDiary, type AnyDiaryLine, type LogsDeps, type RunCard, type RunStatus } from '@openagt/skill-logs'
import { hideLiveDir, inboxPath, liveDir, readLiveCard, readLiveDiary } from './live-card.js'
import { earlierPrs, forReaders, lasting, markerCard, publishChange, recordBranchGone, recordRun, runnerMark, startOf, writeMarker, type Publish, type RunnerMark } from './records.js'
import { projectGitHost, type GitHost, type MergeOutcome } from './git-host.js'
import { basicSkills } from './basic-skills.js'
import { acquireRunLock, isPidAlive, releaseRunLock } from './run-lock.js'
import { runEndedLine } from './ended.js'
import { isBareCommand, nameRun } from './title.js'
import { childEndedLine, tellParent, type ParentDeps } from './parent.js'

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
 * from outside comes through the session's inbox: a line waiting when a turn ends becomes the
 * next turn; when the last turn ended on a question and nothing waited, the run ends `waiting`,
 * keeps its checkout, and the answer resumes it (`resumeRun`): the same run, the same record,
 * continued.
 *
 * SIGINT or SIGTERM to this process stops the run: the agent's whole process tree is ended
 * through the driver, the run is recorded `stopped`, the checkout reclaimed. That is what a
 * dashboard's Stop sends, the pid being on the live card; nothing else steers a run.
 *
 * One-shot: `agent-runner run <prompt>` runs on its own. A scheduler's tick spawns the same thing
 * with the marker already written and the id chosen.
 *
 * A run may name a follow-up (`run --then <prompt>`): once it ends done with a pull request, a
 * fresh agent, a run of its own with its own record, works on the same branch from the prompt,
 * the first run's id after it. The first agent is told, in a line after its prompt, to publish its
 * work without arming the pull request's merge, whatever level the run was given; the follow-up
 * is given no level, its prompt says what it publishes; the follow-up ending done is when this
 * process merges it, through the project's git host (`git-host.ts`). A follow-up that fails or is
 * stopped leaves the request open, for a person.
 *
 * The pull request a run's branch has is read back the same way, through the git host the project
 * declares; a project with no git host package records none.
 *
 * A run may be started for another run, its parent (`run --parent <id>`), and from a branch other
 * than origin's default (`run --base <ref>`); both are on its record for its whole life. When it
 * ends, however it ends, its parent is told (`parent.ts`).
 *
 * A run that makes its own branch writes down the commit the branch was made at, on its record
 * for its whole life: the run's own work is what came after it, which is how it is still told
 * apart once it is merged. A run given a branch that exists (a follow-up's) writes none: that
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

/** The sentence when a follow-up is coming: the agent publishes its work, this process merges the request later. */
export const HOLD_MERGE_LINE = `${PUBLISH_OPENING} and open its pull request, but do not arm its merge: it is merged for you once a follow-up is done.`

/**
 * The sentence a run adds after every prompt of its agent, the first and each message after it:
 * that of its publish level, the hold sentence instead when the run names a follow-up, none for a
 * run with neither. The session sends it after the prompt and writes it down apart from it, so a
 * reader shows the person's words as the person wrote them.
 */
export function addedLine(publish: Publish | undefined, then: string | undefined): string | undefined {
  return then !== undefined ? HOLD_MERGE_LINE : publish !== undefined ? PUBLISH_LINES[publish] : undefined
}

/** The sentence as a session takes it: named, or left out. */
function addedOf(publish: Publish | undefined, then: string | undefined): { added?: string } {
  const added = addedLine(publish, then)
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

export interface RunOptions {
  /** What the agent is told, usually a slash command. */
  prompt: string
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
  /** The model the session starts on; the tool's own default when absent. */
  model?: string
  /** How hard that model may think (`--effort`); the tool's own default when absent. */
  effort?: string
  driver: Driver
  /** The branch to work on, an existing one; a fresh `agent-<id>` when absent. */
  branch?: string
  /** The pull request that branch already has: a follow-up's, so its end does not announce it as new. */
  branchPr?: { number: number; url: string }
  /** The follow-up's prompt: a fresh agent's once this run ends done with a pull request, this run's id after it. */
  then?: string
  /** How far the agent publishes when it finishes; absent, only what the prompt itself asks. */
  publish?: Publish
  /** A text handed to the agent with the prompt, after it: the record keeps it apart from the prompt, which stays the run's name. */
  attached?: string
  /** The coding agent a follow-up run is on, given its id; this run's own when absent. */
  nextDriver?: (id: string) => Driver
  /** The run this one is started for: told when this one ends. */
  parent?: string
  /** The branch the run's fresh branch starts from; origin's default branch when absent. */
  base?: string
  /** What the run is started for (`run --for`), kept on its mark: a thread on the git host, by its address. */
  for?: string
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
  /** The skills linked into the checkout beside the branches skill; the basic ones (`basic-skills.ts`) when absent. */
  skills?: (repo: string) => Promise<readonly SkillLink[]>
  logs?: LogsDeps
  log?: (line: string) => void
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
  /** The follow-up run, when one ran, and how the merge of this run's pull request went when it ended done. */
  then?: RunOutcome & { merge?: MergeOutcome }
}

export async function runCommand(repo: string, opts: RunOptions): Promise<RunOutcome> {
  const outcome = await runOnce(repo, opts)
  return opts.then !== undefined && (await stillOwed(repo, outcome.id, opts.logs)) ? followUp(repo, outcome, opts.then, opts) : outcome
}

/** Whether the run's follow-up is still owed when it ends: a level a message gave it part way took the follow-up away. */
async function stillOwed(repo: string, id: string, logs: LogsDeps = {}): Promise<boolean> {
  const card = await findRun(repo, id, logs).catch(() => undefined)
  return card !== undefined && runnerMark(card)?.then !== undefined
}

async function runOnce(repo: string, opts: RunOptions): Promise<RunOutcome> {
  const git = opts.git ?? nodeGitRunner()
  const now = opts.now ?? (() => new Date())
  const clock = () => now().toISOString()
  const host = opts.host ?? hostname()
  const pid = opts.pid ?? process.pid
  const startedAt = opts.startedAt ?? clock()
  const id = opts.id ?? runIdFrom(startedAt)
  let mark: RunnerMark = { host, pid, ...lasting(opts) }
  const log = opts.log ?? (() => {})
  const logs = opts.logs ?? {}
  const isAlive = opts.isAlive ?? isPidAlive
  const telling: ParentDeps = { host, isAlive, ...(opts.resume ? { resume: opts.resume } : {}), log }

  await acquireRunLock(repo, id, { pid, isAlive })
  try {
    // A person's run marks itself; a scheduler's run was marked before it was spawned. The marker
    // is pushed while the checkout is made and the agent starts: pushing takes seconds, and the
    // person watching the run waits on the agent. It never writes `.git/config`, so the agent's own
    // git is never locked out by it. The run's record waits on it, so it lands after.
    const marking = opts.marked
      ? Promise.resolve()
      : writeMarker(repo, markerCard({ id, startedAt, prompt: opts.prompt, driver: opts.driver.id, ...modelOf(opts.model), ...effortOf(opts.effort), mark }), logs).then(
          marked => {
            if (!marked.ok && !marked.committed) log(`[agent-runner] the run's record could not be written: ${marked.error}`)
          },
          err => log(`[agent-runner] the run's record could not be written: ${errorMessage(err)}`),
        )

    // The run's short name is asked for first of all, beside the checkout and the agent's start
    // rather than after them: the name is the first thing a person watching the run waits on, and
    // asking takes seconds of its own (`title.ts`). Only for a run that will want it the moment its
    // agent starts (`sessionToEnd`): not a subagent, whose row is its task, not a run another tool
    // marked, whose marker may carry its name, nor a bare command, named from its report.
    const naming = new AbortController()
    const named =
      process.env.OPENAGENT_NAME_RUN !== '0' && !opts.marked && opts.parent === undefined && !isBareCommand(opts.prompt)
        ? nameRun(opts.driver, { prompt: opts.prompt, signal: naming.signal })
        : undefined

    // The checkout: the branches package's one sequence, on a fresh branch or the one given.
    // Without one there is no run, and the record says so instead of a marker left running.
    let checkout: { path: string; branch: string }
    try {
      const skills = await (opts.skills ?? basicSkills)(repo).catch((): SkillLink[] => [])
      checkout = opts.branch !== undefined ? await attachCheckout(repo, { agentId: id, branch: opts.branch, skills }, git) : await createCheckout(repo, { agentId: id, skills, ...(opts.base !== undefined ? { base: opts.base } : {}) }, git)
    } catch (err) {
      naming.abort()
      const detail = `could not create a checkout: ${errorMessage(err)}`
      const endedAt = clock()
      await marking
      await recordRun(repo, { ...markerCard({ id, startedAt, prompt: opts.prompt, driver: opts.driver.id, ...modelOf(opts.model), ...effortOf(opts.effort), mark }), status: 'failed', endedAt }, [{ kind: 'ended', status: 'failed', detail, at: endedAt }], logs)
      if (opts.parent !== undefined) await tellParent(repo, opts.parent, childEndedLine({ id, status: 'failed', detail }), telling)
      return { id, status: 'failed', checkout: { reclaimed: false, reason: 'no checkout' }, detail }
    }
    // Only a branch this run made: one it was given holds another run's work, begun elsewhere.
    if (opts.branch === undefined) mark = { ...mark, ...(await startCommit(checkout.path, git)) }
    // A run another tool marked carries what only that tool knows: orchestration writes the task's
    // name as the run's `title` and the task's id under `caller`. This process builds its card from
    // its own arguments, which never held either, and that card seeds the live card the record is
    // written from at the end — so without reading the marker back, a run loses those fields the
    // moment it ends, which is when a person and the tool that started it read them.
    const marked = opts.marked ? await findRun(repo, id).catch(() => undefined) : undefined
    // Awaited here, not returned: the lock is let go in `finally`, and a bare `return` of the
    // promise would run that before the session ends, leaving the run to the sweep.
    return await session(repo, {
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
        branch: checkout.branch,
        caller: { runner: mark, pid, host, ...forReaders(mark), kind: 'prompt', workspace: checkout.path },
      }),
      prompt: opts.prompt,
      ...(opts.attached !== undefined ? { attached: opts.attached } : {}),
      ...addedOf(opts.publish, opts.then),
      driver: opts.driver,
      ...modelOf(opts.model),
      ...effortOf(opts.effort),
      ...(opts.branchPr ? { prBefore: opts.branchPr } : {}),
      ...(named !== undefined ? { named: { title: named, stop: naming } } : {}),
      continued: false,
      marking,
      telling,
      git,
      gitHost: opts.gitHost ?? projectGitHost,
      logs,
      log,
      clock,
    })
  } finally {
    await releaseRunLock(repo, id, pid).catch(() => {})
  }
}

export interface ResumeOptions {
  /** The run to continue: one that ended `waiting`, or any ended run whose session the driver can resume. */
  id: string
  /** The user's words to the agent; or, with `answer`, absent. */
  text?: string
  /** The chosen label or labels, answering the question the run's last turn asked. */
  answer?: string
  /** How far the run takes its work from here on: a level, or `null` for none; the level its record names when absent. */
  publish?: Publish | null
  /** Who resumes the run, kept on its mark with the time: a scheduler's row, which counts the run as its own from then on. */
  by?: string
  driver: Driver
  /** The coding agent a follow-up run is on, given its id, when the run's record names a follow-up; this run's own when absent. */
  nextDriver?: (id: string) => Driver
  /** How an ended parent is continued, in its own process; absent, only a working parent is told. */
  resume?: ParentDeps['resume']
  model?: string
  /** How hard the model may think on this leg; the record's own when absent. */
  effort?: string
  host?: string
  pid?: number
  /** Whether a pid is a live process here: what the run's lock asks of its holder. */
  isAlive?: (pid: number) => boolean
  now?: () => Date
  git?: GitRunner
  /** The project's git host; the one the project declares when absent. */
  gitHost?: GitHost
  /** The skills linked into the checkout beside the branches skill; the basic ones (`basic-skills.ts`) when absent. */
  skills?: (repo: string) => Promise<readonly SkillLink[]>
  logs?: LogsDeps
  log?: (line: string) => void
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
 * here is not. A follow-up the record names is still owed: the
 * agent is told again not to arm the merge, and the follow-up runs once this ends done.
 */
export async function resumeRun(repo: string, opts: ResumeOptions): Promise<RunOutcome> {
  const resumed = await resumeOnce(repo, opts)
  return resumed.then !== undefined ? followUp(repo, resumed.outcome, resumed.then, { ...opts, ...(resumed.model !== undefined ? { model: resumed.model } : {}) }) : resumed.outcome
}

async function resumeOnce(repo: string, opts: ResumeOptions): Promise<{ outcome: RunOutcome; then?: string; model?: string }> {
  const git = opts.git ?? nodeGitRunner()
  const now = opts.now ?? (() => new Date())
  const clock = () => now().toISOString()
  const host = opts.host ?? hostname()
  const pid = opts.pid ?? process.pid
  const logs = opts.logs ?? {}
  const log = opts.log ?? (() => {})

  const id = opts.id
  const isAlive = opts.isAlive ?? isPidAlive
  // Another process of this run, the one that ended it and still records and reclaims, or a
  // resume started just before this one, goes first: this one waits, then reads the run as that
  // one left it.
  await acquireRunLock(repo, id, { pid, isAlive })
  try {
    const card = await findRun(repo, opts.id, logs)
    if (!card) throw new Error(`no run ${opts.id}`)
    // Every process of this run is gone by now, so a record still saying running is one whose
    // process died before it could end it: the sweep's to close first.
    if (card.status === 'running') throw new Error(`run ${opts.id} is still recorded running`)
    const previous = runnerMark(card)
    if (!previous) throw new Error(`run ${opts.id} is not this tool's`)
    const diary = (await readDiary(repo, opts.id, logs)) ?? []
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

    const branch = card.branch ?? agentBranchName(opts.id)
    const path = worktreePath(repo, opts.id)
    const kept = await stat(path).then(s => s.isDirectory(), () => false)
    const skills = await (opts.skills ?? basicSkills)(repo).catch((): SkillLink[] => [])
    const checkout: { path: string; branch: string; again?: true } = kept ? { path, branch } : await attachCheckout(repo, { agentId: opts.id, branch, skills, ...(previous.base !== undefined ? { base: previous.base } : {}) }, git)
    // A checkout that stayed was made by whatever version ran then: its links are brought to what a new one gets.
    if (kept) await relinkCheckout(repo, path, { skills }, git)
    // A branch that was gone everywhere was just made again, from where it starts as that is now:
    // that is where the run's own work begins. One still on origin came back with its work.
    const restarted = checkout.again ? await startCommit(checkout.path, git) : {}

    // The record is written running again over the ended one, so every reader sees the run in flight.
    // The level its record names, or the one this resume gives it from here on. A level given
    // takes the follow-up away: the person has said how far the run goes, and the follow-up was
    // the merge's.
    const { publish: recorded, then: owed, ...lasts } = lasting(previous)
    const publish = opts.publish === undefined ? recorded : (opts.publish ?? undefined)
    const then = opts.publish === undefined ? owed : undefined
    const mark: RunnerMark = { host, pid, ...lasts, ...(publish !== undefined ? { publish } : {}), ...(then !== undefined ? { then } : {}), ...restarted, ...(opts.by !== undefined ? { resumed: { by: opts.by, at: clock() } } : {}) }
    const runningCard: RunCard = { ...card, status: 'running', caller: { ...card.caller, runner: mark, pid, host, ...forReaders(mark), workspace: checkout.path } }
    delete runningCard.endedAt
    // A level taken away by this resume is no longer the run's, for its readers either.
    if (mark.publish === undefined) delete runningCard.caller?.['publish']
    // A record that says its work was landed lost its branch to that. On a branch made again the
    // work is new and not landed: left on the record, every reader would go on saying it is.
    if (checkout.again) delete runningCard.caller?.['landed']
    const reopened = await recordRun(repo, runningCard, diary, logs)
    if (!reopened.ok && !reopened.committed) log(`[agent-runner] the run's record could not be written: ${reopened.error}`)

    const model = opts.model ?? card.model
    const effort = opts.effort ?? card.effort
    const outcome = await session(repo, {
      id: opts.id,
      checkout,
      card: { ...runningCard },
      priorDiary: diary,
      prompt,
      ...addedOf(mark.publish, mark.then),
      driver: opts.driver,
      ...modelOf(model),
      ...effortOf(effort),
      continued: true,
      ...(sessionId !== undefined ? { resumeSessionId: sessionId } : {}),
      telling: { host, isAlive, ...(opts.resume ? { resume: opts.resume } : {}), log },
      git,
      gitHost: opts.gitHost ?? projectGitHost,
      logs,
      log,
      clock,
    })
    return { outcome, ...(then !== undefined && (await stillOwed(repo, opts.id, logs)) ? { then } : {}), ...modelOf(model) }
  } finally {
    await releaseRunLock(repo, id, pid).catch(() => {})
  }
}

/**
 * The follow-up a run named, once the run ended done with a pull request: a fresh agent on the
 * run's branch, a run of its own, given the prompt and the first run's id. When it ends done the
 * first run's request is merged through the project's git host; otherwise the request stays open. A
 * run that did not end done, or opened no request, has nothing to follow up.
 */
async function followUp(repo: string, first: RunOutcome, then: string, opts: FollowUpContext): Promise<RunOutcome> {
  if (first.status !== 'done' || !first.pr || !first.branch) return first
  const id = runIdFrom((opts.now ?? (() => new Date()))().toISOString())
  const next = await runCommand(repo, {
    prompt: `${then} ${first.id}`,
    id,
    branch: first.branch,
    branchPr: first.pr,
    driver: opts.nextDriver ? opts.nextDriver(id) : opts.driver,
    ...pick(opts, ['model', 'host', 'pid', 'isAlive', 'now', 'git', 'gitHost', 'skills', 'logs', 'log']),
  })
  if (next.status !== 'done') return { ...first, then: next }
  return { ...first, then: { ...next, merge: await (opts.gitHost ?? projectGitHost).mergeRequest(repo, first.pr.number) } }
}

/** What a follow-up run shares with the run before it: where it runs and how, never what it is for. */
type FollowUpContext = Pick<RunOptions, 'driver' | 'nextDriver' | 'model' | 'host' | 'pid' | 'isAlive' | 'now' | 'git' | 'gitHost' | 'skills' | 'logs' | 'log'>

function pick<T extends object, K extends keyof T>(from: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {}
  for (const key of keys) if (from[key] !== undefined) picked[key] = from[key]
  return picked
}

interface SessionRun {
  id: string
  checkout: { path: string; branch: string }
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
  /** The pull request the run's branch had before this session: its end announces only a new one. */
  prBefore?: { url: string }
  continued: boolean
  /** The run's name, asked for as the run began (`runOnce`); stopped when the run is. */
  named?: { title: Promise<string | undefined>; stop: AbortController }
  /** The run's own marker being pushed, when it writes one: the record waits on it, so it lands after. */
  marking?: Promise<void>
  resumeSessionId?: string
  /** What telling the run's parent needs, when its record names one. */
  telling: ParentDeps
  git: GitRunner
  gitHost: GitHost
  logs: LogsDeps
  log: (line: string) => void
  clock: () => string
}

/** A prompt this process owes the agent, and the level a message taken from the inbox after the run's last turn gave the run with it. */
interface Queued {
  prompt: string
  publish?: string
}

/** An inbox line as the prompt it becomes, with the level its message carries. */
function queued(line: InboxLine): Queued {
  return { prompt: promptOf(line), ...(line.kind === 'message' && line.publish !== undefined ? { publish: line.publish } : {}) }
}

/** The session, its end, the record and the reclaim: the part a fresh run and a continued one share. */
async function session(repo: string, run: SessionRun): Promise<RunOutcome> {
  const dir = liveDir(run.checkout.path)
  const inbox = inboxPath(run.checkout.path)
  if (run.priorDiary) {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, logDiaryFile(run.id)), run.priorDiary.map(line => JSON.stringify(line) + '\n').join(''))
  }
  // A checkout with an untracked directory in it is a dirty tree, which the branches rule never reclaims.
  await hideLiveDir(run.checkout.path).catch(() => {})

  // A signal stops the run: the first aborts the session, which ends the agent's process tree.
  // The handlers stay until this process is done, so a second signal, or one that comes while the
  // run records and reclaims, is ignored instead of killing the process halfway through a write.
  const stop = new AbortController()
  const onSignal = (): void => stop.abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    return await sessionToEnd(repo, run, dir, inbox, stop.signal)
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

async function sessionToEnd(repo: string, run: SessionRun, dir: string, inbox: string, stopped: AbortSignal): Promise<RunOutcome> {
  const { id: _id, status: _status, endedAt: _endedAt, ...startCard } = run.card
  let status: LogEndStatus = 'done'
  let detail: string | undefined
  let branch = run.checkout.branch
  let pr: RunOutcome['pr']
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
      ...(run.model !== undefined ? { model: run.model } : {}),
      ...(run.effort !== undefined ? { effort: run.effort } : {}),
      signal: stopped,
      ...(run.resumeSessionId !== undefined ? { resumeSessionId: run.resumeSessionId } : {}),
      log: { dir, card: { id: run.id, ...startCard }, continue: run.continued },
    })
  } catch (err) {
    status = 'failed'
    detail = errorMessage(err)
  }
  // The run's short name, asked of a small model beside the first turn (`title.ts`), or as the run
  // began, before its checkout was made, when it was a fresh one no other tool marked (`runOnce`): a run that is
  // being continued was named when it began, and one whose agent never started has nothing to name.
  // A subagent is not named: its row is its task, written by the agent that started it, and an
  // orchestration of a dozen of them would pay for a dozen namings for rows nobody looks for.
  // `OPENAGENT_NAME_RUN=0` is the person's setting, put in this process's environment by whoever
  // started it: naming costs money for something only a person looks at, so it can be declined.
  // A bare command is named later, from its agent's report (`title.ts`).
  const mayName = process.env.OPENAGENT_NAME_RUN !== '0' && driverSession !== undefined && !run.continued && run.card.title === undefined && runnerMark(run.card)?.parent === undefined
  let nameFromReport = mayName && isBareCommand(run.prompt)
  // A fresh run's name was asked for as the run began (`runOnce`): it is dropped when the run will
  // not take it, and stopped with the run.
  const asked = run.named
  if (asked && (!mayName || stopped.aborted)) asked.stop.abort()
  else if (asked) stopped.addEventListener('abort', () => asked.stop.abort(), { once: true })
  const naming =
    mayName && !nameFromReport
      ? (run.named?.title ?? nameRun(run.driver, { prompt: run.prompt, signal: stopped })).then(
          async title => {
            if (title !== undefined) await driverSession?.log?.title(title)
          },
          () => {},
        )
      : undefined
  // The sentence after every prompt, and the mark that keeps the level it says: a message can
  // change the level from there on (`publish` on its inbox line), and the record says so then.
  let added = run.added
  let mark = runnerMark(run.card)
  const takeLevel = async (word: string | undefined): Promise<void> => {
    const level = publishChange(word)
    if (level === undefined || !mark) return
    // A level given part way takes the follow-up away too: the person has said how far the run
    // goes, and the follow-up was the merge's.
    const { publish: _was, then: _owed, ...rest } = mark
    mark = { ...rest, ...(level !== null ? { publish: level } : {}) }
    added = addedLine(mark.publish, undefined)
    await driverSession?.log?.patch({ caller: { runner: mark, publish: mark.publish } })
  }
  // A line the driver takes from the inbox is handed here first: a message may say how far the run
  // takes its work from it on, and every line goes with the sentence in force now, which a line
  // handed over in a later turn may have changed.
  const onInboxLine = async (line: InboxLine, sent: DriverPromptOptions): Promise<DriverPromptOptions> => {
    if (line.kind === 'message') await takeLevel(line.publish)
    const { added: _was, ...rest } = sent
    return added !== undefined ? { ...rest, added } : rest
  }
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
      try {
        for (const [i, { prompt, publish }] of queue.entries()) {
          await takeLevel(publish)
          // Only the last one drains the inbox: a line written meanwhile comes after these.
          const last = i === queue.length - 1
          const handed = attached
          attached = undefined
          const sent = { ...(last ? { inbox, onInboxLine } : {}), ...(resume ? { resume: true } : {}), ...(handed !== undefined ? { attached: handed } : {}), ...(added !== undefined ? { added } : {}) }
          const session = driverSession
          const turn = fresh
            ? await afresh(session, run, prompt, sent)
            : await session.prompt(prompt, sent).catch((err: unknown) => {
                if (err instanceof ConversationGoneError) return afresh(session, run, prompt, sent)
                throw err
              })
          fresh = false
          lastText = turn.text
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
        question = parseQuestion(lastText)?.title
        if (question !== undefined) status = 'waiting'
      }
      // Named from its first report once its status is settled, before it is said ended, so the
      // name's line in the diary comes before the ended one; a stop meanwhile only cuts the naming
      // short. A question is no report of the work, and a few seconds is all a name may hold the
      // end up.
      if (nameFromReport && status === 'done' && lastText.trim() !== '') {
        nameFromReport = false
        const title = await nameRun(run.driver, { prompt: lastText, from: 'report', signal: stopped, timeoutMs: REPORT_NAMING_TIMEOUT_MS })
        if (title !== undefined) await driverSession.log?.title(title)
      }

      // Where the work ended up: the agent renames its branch itself, and the pull request it
      // opened, if any, is read back off the branch through the project's git host.
      branch = (await worktreeBranch(run.checkout.path, run.git).catch(() => undefined)) ?? run.checkout.branch
      pr = await run.gitHost.requestOfBranch(repo, branch).catch(() => undefined)
      if (pr && named && pr.url !== named.url) earlier = [...earlier, { number: named.number, url: named.url }]
      if (pr) named = pr
      // Each once, and never the one the card names: work moved back to a branch takes its request back.
      earlier = earlier.filter((one, at) => one.url !== named?.url && earlier.findIndex(other => other.url === one.url) === at)
      const live = driverSession.log
      if (!live) break
      // Written whenever the run has had one, so a list emptied by the work moving back is said too.
      saidEarlier ||= earlier.length > 0
      await live.patch({ branch, ...(pr ? { pr } : {}), ...(saidEarlier ? { caller: { earlierPrs: earlier } } : {}) })
      // The ended line leaves out a reason the diary already holds: the agent's error line, written
      // just before its process exited, says it, so the ended line says only that the agent exited.
      await live.end(status, status === 'failed' && failure instanceof AgentExitError ? failure.exit : detail)
      await live.settled()

      // The card says ended now, so a line written from here on goes to the project's resume
      // hook, which waits for this process. What is in the inbox was written before: this
      // process's to send. A stopped run was stopped on purpose; what reached it is dropped.
      if (status === 'stopped' || stopped.aborted) break
      queue = (await takeInbox(inbox)).map(queued)
      if (queue.length === 0) break
      await live.reopen()
    }
  } finally {
    await driverSession?.dispose().catch(() => {})
  }

  // The name lands on the card before the record is copied: a run named after that copy would be
  // named only in its checkout, which is removed with the run.
  await naming
  // The record: the two files the session kept, copied onto the branch unchanged.
  const live = driverSession?.log
  const card = (await readLiveCard(run.checkout.path, run.id)) ?? { ...run.card, status, endedAt: run.clock(), branch, ...(pr ? { pr } : {}), ...(saidEarlier ? { caller: { ...run.card.caller, earlierPrs: earlier } } : {}) }
  const diary = live ? await readLiveDiary(run.checkout.path, run.id) : [...(run.priorDiary ?? []), { kind: 'ended', status, ...(detail !== undefined ? { detail } : {}), at: card.endedAt ?? run.clock() }]
  await run.marking
  const recorded = await recordRun(repo, card, diary, run.logs)
  if (!recorded.ok && !recorded.committed) run.log(`[agent-runner] the run's record could not be written: ${recorded.error}`)

  // The person's line, when this end needs them: a question, or a pull request new to this session.
  await runEndedLine(repo, { id: run.id, prompt: run.card.intent ?? '', status, ...(question !== undefined ? { question } : {}), ...(pr ? { pr } : {}), ...((run.prBefore ?? run.card.pr) ? { prBefore: run.prBefore ?? run.card.pr } : {}) }, { log: run.log })

  // The run's parent, when it has one, is told how it ended, once the branch it would be pointed
  // at is known to have stayed: an empty one goes with the checkout.
  const parent = runnerMark(run.card)?.parent
  const tell = async (branchStayed: boolean): Promise<void> => {
    if (parent === undefined) return
    const line = childEndedLine({ id: run.id, status, ...(detail !== undefined ? { detail } : {}), ...(question !== undefined ? { question } : {}), ...(branchStayed ? { branch } : {}), ...(pr ? { pr } : {}), lastWords })
    await tellParent(repo, parent, line, run.telling)
  }

  // The checkout goes once its branch holds everything in it (the branches rule), and the branch
  // stays on this machine: nothing is pushed here, publishing is the agent's when it was asked, the person's otherwise. A dirty tree
  // keeps the checkout, and the sweep tries again later. A waiting run keeps it on purpose: the
  // answer resumes the run there.
  if (status === 'waiting') {
    await tell(true)
    return outcomeOf(run.id, status, branch, pr, card.cost, { reclaimed: false, reason: 'waiting' }, detail)
  }
  const reclaimed = await reclaimWorktree(repo, run.checkout.path, { birthBranch: agentBranchName(run.id), ...startOf(run.card), git: run.git })
  if (reclaimed.ok) {
    const rewritten = await recordBranchGone(repo, card, diary, reclaimed.branchesDeleted, run.logs)
    if (rewritten && !rewritten.ok && !rewritten.committed) run.log(`[agent-runner] the run's record could not be written: ${rewritten.error}`)
  }
  await tell(!(reclaimed.ok && reclaimed.branchesDeleted?.includes(branch)))
  return outcomeOf(run.id, status, branch, pr, card.cost, reclaimed.ok ? { reclaimed: true } : { reclaimed: false, reason: reclaimed.reason }, detail)
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

function outcomeOf(id: string, status: Exclude<RunStatus, 'running'>, branch: string, pr: RunOutcome['pr'], cost: number | undefined, checkout: RunOutcome['checkout'], detail: string | undefined): RunOutcome {
  return {
    id,
    status,
    branch,
    ...(pr ? { pr } : {}),
    ...(cost !== undefined ? { cost } : {}),
    checkout,
    ...(detail !== undefined ? { detail } : {}),
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

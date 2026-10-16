import { stat } from 'node:fs/promises'
import { gitReason, type FileBranchWrite, type GitRunner } from '@openagt/agent-data'
import { isAgentBranch, removeWorktree, worktreeBranch, worktreeClean, worktreePath } from '@openagt/skill-branches'
import { agentLines, findRun, listRuns, publicCard, readDiary, type RunCard } from '@openagt/skill-logs'
import { AGENT_ID_ENV, isDriverName, markerCard, readLiveCard, recordRun, runIdFrom, runnerMark, type DriverName, type readyToRun, type spawnRun } from '@openagt/agent-runner'
import { APPROVE, planApproved, planQuestion, readPlan, writePlan } from './plan.js'
import { parsePlan, taskText, type Plan, type PlanTask } from './tasks.js'
import { cutOutput, type Ran } from './check.js'
import { DEFAULT_AT_ONCE, LEVELS, readSettings, runnerFor, type Level } from './settings.js'

/**
 * A main agent and its subagents. The main agent is the run whose agent calls the command: its id
 * is in its environment (`AGENT_ID`). A subagent is a run started for it: a run of its own, in its
 * own checkout, on a branch started from the main agent's, with the main agent as its parent on
 * its record. The runner tells the main agent when a subagent ends; nothing here waits.
 *
 * No subagent starts before the person approved the main agent's plan (`plan.ts`), and every
 * subagent's words come from one task of that plan (`tasks.ts`): the main agent says which task,
 * never what to do, so nothing is started that the person did not read. A subagent's work reaches
 * the main agent's branch by landing: merged there, its own branch gone.
 * What the subagent itself changed stays readable for good: its last commit is kept under a ref
 * of its own and named on its record.
 */

/** The ref a landed subagent's last commit is kept under, on this machine, so git never drops it. */
export function landedRef(id: string): string {
  return `refs/landed/${id}`
}

/** What every subagent is told after its task: where its work goes, and that nobody answers it. */
export const SUBAGENT_LINES =
  'You are a subagent: another agent started you for this one task and reads your last reply as its result. Commit your work to your branch and publish nothing: no push, no pull request. Nobody will answer a question: decide yourself, and say in your last reply what you did and what you decided.'

/** The prompt a subagent gets: the task, then the lines above. */
export function subagentPrompt(task: string): string {
  return `${task}\n\n${SUBAGENT_LINES}`
}

/**
 * What a retried task says: the task's own words, then that an earlier agent tried it and what to
 * do differently. The earlier agent's work is on its own branch and not in this one's checkout,
 * which starts from the main agent's branch like any other subagent's, so it is told to do the task.
 */
export function retryText(task: string, feedback: string): string {
  return `${task}\n\nAnother agent tried this task before you and its work was not taken: nothing of it is in your checkout, so do the task. What to do differently: ${feedback}`
}

/** The task a subagent was given, off its record: its prompt without the lines the command added. */
function taskOf(intent: string): string {
  return intent.endsWith(SUBAGENT_LINES) ? intent.slice(0, -SUBAGENT_LINES.length).trimEnd() : intent
}

export type Refusal = { ok: false; reason: string; [key: string]: unknown }

/** A command refused: the JSON it answers and the line for a person. */
export class Refused extends Error {
  constructor(readonly outcome: Refusal, readonly line: string) {
    super(line)
  }
}

export interface SubagentDeps {
  git: GitRunner
  /** This machine's name, as a run's record carries it. */
  host: string
  isAlive: (pid: number) => boolean
  /** Ask a run's process to stop. */
  stop: (pid: number) => void
  ready: typeof readyToRun
  now: () => Date
  /** Put a run's first record, `running`, on the data branch. */
  mark: (repo: string, card: RunCard) => Promise<FileBranchWrite>
  /** Take that record back. */
  unmark: (repo: string, id: string) => Promise<unknown>
  /** Start a run's process, detached; resolves once it is spawned. */
  spawn: typeof spawnRun
  /** Run a check in a checkout: what it printed, and how it exited. */
  run: (command: string, cwd: string) => Promise<Ran>
}

/** A subagent as the command prints it: the record's own fields, its task in place of its whole prompt. */
export type Subagent = Omit<RunCard, 'caller'>

function view(card: RunCard): Subagent {
  const shown = publicCard(card)
  return shown.intent !== undefined ? { ...shown, intent: taskOf(shown.intent) } : shown
}

/**
 * The run whose agent is calling: the one `AGENT_ID` names, by its record, or by the live card in
 * its checkout while its first record is still on its way to the branch.
 */
async function mainAgent(repo: string, env: NodeJS.ProcessEnv): Promise<RunCard> {
  const id = env[AGENT_ID_ENV]?.trim()
  if (!id) throw new Refused({ ok: false, reason: 'not-a-run' }, `${AGENT_ID_ENV} is not set: only an agent started as a run has subagents; do the task yourself`)
  const card = (await findRun(repo, id)) ?? (await readLiveCard(worktreePath(repo, id), id))
  if (!card) throw new Refused({ ok: false, reason: 'not-a-run', id }, `no run ${id} in this project: only an agent started as a run has subagents; do the task yourself`)
  return card
}

/** One of the caller's subagents, by id. */
async function subagentOf(repo: string, main: RunCard, id: string): Promise<RunCard> {
  const card = await findRun(repo, id)
  if (!card || runnerMark(card)?.parent !== main.id) throw new Refused({ ok: false, reason: 'not-yours', id }, `${id} is not a subagent of this run`)
  return card
}

/** Every subagent of the caller, newest first, as the records say. */
async function subagentsOf(repo: string, main: string): Promise<RunCard[]> {
  return (await listRuns(repo)).filter(card => runnerMark(card)?.parent === main)
}

/** The task of the plan a subagent was started on, as `start` wrote it on its record. */
function taskIdOf(card: RunCard): string | undefined {
  const task = card.caller?.['task']
  return typeof task === 'string' ? task : undefined
}

/** Whether a subagent's work is on the main agent's branch: `land` wrote the commit it landed. */
function landed(card: RunCard): boolean {
  return typeof card.caller?.['landed'] === 'string'
}

/** The tasks of the plan the caller has landed. */
function landedTasks(mine: readonly RunCard[]): Set<string> {
  return new Set(mine.flatMap(card => (landed(card) ? [taskIdOf(card) ?? ''] : [])))
}

/** The caller's subagents on one task, newest first. */
function runsOn(mine: readonly RunCard[], task: string): RunCard[] {
  return mine.filter(card => taskIdOf(card) === task)
}

/** What one task of the plan stands at; `next` answers one of these per task. */
export type TaskState = 'landed' | 'running' | 'ended' | 'waiting' | 'yours' | 'startable'

/** One task of the plan as `next` answers it: what it is, where its work stands, and what it waits for. */
export interface TaskStanding {
  id: string
  name: string
  level?: Level
  files?: string[]
  state: TaskState
  /** The caller's subagents on this task, newest first: what to read, land or retry. */
  runs?: string[]
  /** For a task waiting: the tasks it needs that are not landed. */
  needs?: string[]
}

/** The tasks a task needs that are not landed yet; a task that names itself waits for nothing. */
function unlanded(task: PlanTask, done: ReadonlySet<string>): string[] {
  return (task.depends ?? []).filter(one => one !== task.id && !done.has(one))
}

/**
 * Where one task stands, the first of these that holds: landed, a subagent of it is running, a
 * subagent of it ended and was not landed, the main agent's own (no subagent may take it), waiting
 * for a task that is not landed, startable. The order is the order `start` refuses in, so a
 * startable task is one `start` takes.
 */
function stateOf(task: PlanTask, runs: readonly RunCard[], done: ReadonlySet<string>): { state: TaskState; needs?: string[] } {
  if (done.has(task.id)) return { state: 'landed' }
  if (runs.some(card => card.status === 'running')) return { state: 'running' }
  if (runs.length > 0) return { state: 'ended' }
  if (task.uncertainty === undefined || task.uncertainty > 0 || task.level === undefined) return { state: 'yours' }
  const needs = unlanded(task, done)
  return needs.length > 0 ? { state: 'waiting', needs } : { state: 'startable' }
}

/**
 * Start a subagent on one task of the plan: a run with the caller as its parent, its branch
 * started from the branch the caller's checkout is on. The task's words are the plan's, not the
 * caller's: the plan's shared context, the task's own heading and body, the files it owns and its
 * check line. Its heading goes on the record as the run's name, which is what a list of runs and
 * the dashboard's rows call it.
 *
 * The task says how hard it is, and the person's setting for that level names the coding agent and
 * model; a level nobody set runs on the caller's own. A task of any uncertainty stays with the
 * caller: a subagent is told nobody will answer it, so a task with real alternatives in it is no
 * subagent's. A subagent starts none of its own, and no more of the caller's run at once than the
 * setting allows. A task whose `Needs:` names a task that is not landed is refused, and a task
 * owning a file a running subagent's task owns too is said and started. Its record is written
 * before its process is spawned, as a scheduler's run is, so the id answered is one `list`, `read`
 * and `stop` already know.
 */
export async function startSubagent(repo: string, env: NodeJS.ProcessEnv, opts: { task: string }, deps: SubagentDeps): Promise<Started> {
  return start(repo, await mainAgent(repo, env), opts.task, {}, deps)
}

/** A subagent started, as the command answers it. */
export interface Started {
  id: string
  task: string
  name: string
  level: Level
  driver: DriverName
  model?: string
  base: string
  /** The caller's checkout holds changes the subagent's branch does not: said, and it starts all the same. */
  uncommitted?: true
  /** Running subagents whose task owns a file this task owns too: said, and it starts all the same. */
  sharedFiles?: SharedFiles[]
  /** The subagent this one was started to retry. */
  retries?: string
}

/** A running subagent that owns files this task owns too. */
export interface SharedFiles {
  id: string
  /** Its task's name, as the plan writes it. */
  task: string
  files: string[]
}

/**
 * Start one subagent on one task, for both `start` and `retry`: every rule holds for either, so
 * neither has a rule of its own. `retries` names the subagent a retry is a second attempt at, and
 * `feedback` is what that attempt is told to do differently.
 */
async function start(repo: string, main: RunCard, which: string, opts: { retries?: string; feedback?: string }, deps: SubagentDeps): Promise<Started> {
  if (runnerMark(main)?.parent !== undefined) throw new Refused({ ok: false, reason: 'subagent' }, 'a subagent starts no subagents: do the task yourself')
  const checkout = worktreePath(repo, main.id)
  const base = await worktreeBranch(checkout, deps.git)
  if (base === undefined) throw new Refused({ ok: false, reason: 'no-branch' }, `the checkout of ${main.id} is on no branch: a subagent starts from a branch`)
  // No subagent before the person said yes to the plan as it is saved now, and no words but its own.
  const { plan, task } = await taskOfPlan(repo, main.id, which, deps)
  const mine = await subagentsOf(repo, main.id)
  waitsFor(task, mine)
  const settings = await readSettings(repo)
  const own = { driver: main.driver !== undefined && isDriverName(main.driver) ? main.driver : 'claude-code', ...(main.model !== undefined ? { model: main.model } : {}) } as const
  const { driver, model } = runnerFor(settings, task.level, own)
  const ready = await deps.ready(repo, driver)
  if (ready.problems.length > 0) throw new Refused({ ok: false, reason: 'not-ready', ...ready }, ready.problems.join(' '))
  const atOnce = settings.atOnce ?? DEFAULT_AT_ONCE
  const running = mine.filter(card => card.status === 'running').length
  if (running >= atOnce) throw new Refused({ ok: false, reason: 'limit', running, atOnce }, `${running} of your subagents are running, the most the person allows at once: end your reply, and start this one when you are told one ended`)
  // The subagent's branch starts from the caller's last commit: what is not committed is not in it.
  const uncommitted = !(await worktreeClean(checkout, deps.git).catch(() => true))
  const shared = sharedFiles(plan, task, mine)
  const startedAt = deps.now().toISOString()
  const id = runIdFrom(startedAt)
  const words = taskText(plan, task)
  const prompt = subagentPrompt(opts.feedback !== undefined ? retryText(words, opts.feedback) : words)
  const named = model !== undefined ? { model } : {}
  const marker = markerCard({ id, startedAt, prompt, driver, ...named, mark: { host: deps.host, parent: main.id, base } })
  const marked = await deps.mark(repo, { ...marker, title: task.name, caller: { ...marker.caller, task: task.id, ...(opts.retries !== undefined ? { retries: opts.retries } : {}) } })
  if (!marked.ok && !marked.committed) throw new Error(`the subagent's record could not be written: ${marked.error}`)
  try {
    await deps.spawn(repo, { id, prompt, driver, ...named, parent: main.id, base })
  } catch (err) {
    await deps.unmark(repo, id)
    throw err
  }
  return {
    id,
    task: task.id,
    name: task.name,
    level: task.level,
    driver,
    ...named,
    base,
    ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
    ...(uncommitted ? { uncommitted: true } : {}),
    ...(shared.length > 0 ? { sharedFiles: shared } : {}),
  }
}

/**
 * A task whose `Needs:` names a task that is not landed is refused: the subagent's checkout starts
 * from the main agent's branch, so a task started before the work it needs is landed is a task
 * done against work that is not there. What each of those tasks stands at is said, since the main
 * agent waits for one that is running, lands one that ended, and starts one nobody started.
 */
function waitsFor(task: PlanTask, mine: readonly RunCard[]): void {
  const waiting = unlanded(task, landedTasks(mine)).map(one => {
    const runs = runsOn(mine, one)
    const running = runs.find(card => card.status === 'running')
    if (running !== undefined) return { task: one, state: 'running' as const, id: running.id }
    const ended = runs[0]
    if (ended !== undefined) return { task: one, state: 'ended' as const, id: ended.id, status: ended.status }
    return { task: one, state: 'unstarted' as const }
  })
  if (waiting.length === 0) return
  const said = waiting.map(one =>
    one.state === 'running' ? `${one.task} (${one.id} is running it)` : one.state === 'ended' ? `${one.task} (${one.id} ended ${one.status} and is not landed)` : `${one.task} (nobody started it)`,
  )
  throw new Refused(
    { ok: false, reason: 'needs', task: task.id, waiting },
    `the task "${task.name}" needs work that is not on your branch yet: ${said.join('; ')}. Land what ended, start what nobody started, wait for what runs, and start this task once every one of them is landed`,
  )
}

/**
 * The running subagents whose task owns a file this task owns too, by the plan's own spelling of
 * the path. Two agents writing one file is said and not refused: the person approved a plan that
 * says so, and the main agent may have meant it.
 */
function sharedFiles(plan: Plan, task: PlanTask, mine: readonly RunCard[]): SharedFiles[] {
  const owned = new Set(task.files ?? [])
  if (owned.size === 0) return []
  return mine.flatMap(card => {
    if (card.status !== 'running') return []
    const other = plan.tasks.find(one => one.id === taskIdOf(card))
    const files = (other?.files ?? []).filter(file => owned.has(file))
    return other !== undefined && files.length > 0 ? [{ id: card.id, task: other.name, files }] : []
  })
}

/**
 * One task of the caller's approved plan, ready to be a subagent's: the plan is saved, the person
 * approved it as it is saved now, the task is in it, it is rated and clearly not uncertain, and it
 * says how hard it is. Every one of those is a refusal of its own, so the caller is told which.
 */
async function taskOfPlan(repo: string, main: string, id: string, deps: SubagentDeps): Promise<{ plan: Plan; task: PlanTask & { level: Level } }> {
  const plan = await approvedPlan(repo, main, deps)
  const task = plan.tasks.find(one => one.id === id)
  const tasks = plan.tasks.map(one => one.id)
  if (task === undefined) throw new Refused({ ok: false, reason: 'no-task', task: id, tasks }, `your plan has no task "${id}": its tasks are ${tasks.join(', ')}`)
  if (task.uncertainty === undefined) throw new Refused({ ok: false, reason: 'no-uncertainty', task: id }, `the task "${task.name}" has no \`Uncertainty:\` line: rate it 0 to 10 in the plan, 0 when it holds no meaningful alternatives, and save the plan again`)
  if (task.uncertainty > 0)
    throw new Refused(
      { ok: false, reason: 'uncertain', task: id, uncertainty: task.uncertainty },
      `the task "${task.name}" is at uncertainty ${task.uncertainty}: nobody answers a subagent, so do this task yourself and start subagents on the tasks rated 0`,
    )
  if (task.level === undefined) throw new Refused({ ok: false, reason: 'no-level', task: id }, `the task "${task.name}" has no \`Level:\` line: say ${LEVELS.join(' or ')} in the plan and save it again, since the person's settings pick the model for it`)
  return { plan, task: { ...task, level: task.level } }
}

/** The caller's plan, saved and approved by the person as it is saved now; either missing is a refusal of its own. */
async function approvedPlan(repo: string, main: string, deps: SubagentDeps): Promise<Plan> {
  const text = await readPlan(repo, main, deps.git)
  if (text === undefined) throw new Refused({ ok: false, reason: 'no-plan' }, 'no plan is saved: save your plan with `orchestration plan <file>` and ask the person the question it answers, before any subagent starts')
  if (!(await planApproved(repo, main, text))) {
    const question = planQuestion(text)
    throw new Refused({ ok: false, reason: 'not-approved', question }, `the person has not approved the saved plan: ask them "${question}" with the option "${APPROVE}", end your reply there, and start once they chose it`)
  }
  return parsePlan(text)
}

/**
 * Where every task of the caller's plan stands, and how many more subagents may run at once: the
 * main agent reads this instead of keeping its plan's state in its head, since `start` would
 * otherwise answer the same question one refusal at a time, after the money is spent. A startable
 * task still waits when no place is left.
 */
export async function nextTasks(repo: string, env: NodeJS.ProcessEnv, deps: SubagentDeps): Promise<{ atOnce: number; running: number; places: number; tasks: TaskStanding[] }> {
  const main = await mainAgent(repo, env)
  const plan = await approvedPlan(repo, main.id, deps)
  const mine = await subagentsOf(repo, main.id)
  const done = landedTasks(mine)
  const running = mine.filter(card => card.status === 'running').length
  const atOnce = (await readSettings(repo)).atOnce ?? DEFAULT_AT_ONCE
  return {
    atOnce,
    running,
    places: Math.max(0, atOnce - running),
    tasks: plan.tasks.map(task => {
      const runs = runsOn(mine, task.id)
      return {
        id: task.id,
        name: task.name,
        ...(task.level !== undefined ? { level: task.level } : {}),
        ...(task.files !== undefined ? { files: task.files } : {}),
        ...stateOf(task, runs, done),
        ...(runs.length > 0 ? { runs: runs.map(card => card.id) } : {}),
      }
    }),
  }
}

/**
 * Another attempt at the task a subagent did: a new subagent on the same task, told what to do
 * differently. Its branch starts from the caller's, as any subagent's does, so the failed attempt's
 * commits stay on its own branch for the main agent to read, and the retry's branch is the one to
 * land. Every rule `start` holds to holds here: the plan is approved, the task's dependencies are
 * landed, there is a place free, and the task is one a subagent may take.
 *
 * Only a subagent that is still running is refused. One that ended `done` may be retried too: a
 * `done` subagent whose check fails on `land` is exactly the one that needs another attempt.
 */
export async function retrySubagent(repo: string, env: NodeJS.ProcessEnv, id: string, feedback: string, deps: SubagentDeps): Promise<Started> {
  const main = await mainAgent(repo, env)
  const card = await subagentOf(repo, main, id)
  if (card.status === 'running') throw new Refused({ ok: false, reason: 'running', id }, `${id} is still running: read it, or stop it, and retry it once it has ended`)
  const task = taskIdOf(card)
  if (task === undefined) throw new Refused({ ok: false, reason: 'no-task', id }, `${id} was not started on a task of your plan: there is no task to retry`)
  return start(repo, main, task, { retries: id, feedback }, deps)
}

/** The caller's subagents, newest first. */
export async function listSubagents(repo: string, env: NodeJS.ProcessEnv): Promise<Subagent[]> {
  const main = await mainAgent(repo, env)
  return (await listRuns(repo)).filter(card => runnerMark(card)?.parent === main.id).map(view)
}

/** One of the caller's subagents, with its last reply as `result` once it has one on its record. */
export async function readSubagent(repo: string, env: NodeJS.ProcessEnv, id: string): Promise<Subagent & { result?: string }> {
  const card = await subagentOf(repo, await mainAgent(repo, env), id)
  const result = agentLines((await readDiary(repo, id)) ?? [])
    .flatMap(line => (line.kind === 'result' ? [line.text] : []))
    .at(-1)
  return { ...view(card), ...(result !== undefined ? { result } : {}) }
}

/**
 * Stop one of the caller's subagents: the signal a person's Stop sends, to the process its live
 * card names. The run records itself `stopped` and tells its parent, like any other end.
 */
export async function stopSubagent(repo: string, env: NodeJS.ProcessEnv, id: string, deps: SubagentDeps): Promise<{ id: string }> {
  const card = await subagentOf(repo, await mainAgent(repo, env), id)
  if (card.status !== 'running') throw new Refused({ ok: false, reason: 'not-running', id, status: card.status }, `${id} is not running: it ended ${card.status}`)
  if (runnerMark(card)?.host !== deps.host) throw new Refused({ ok: false, reason: 'other-machine', id }, `${id} runs on another machine: it can only be stopped there`)
  const live = await readLiveCard(worktreePath(repo, id), id)
  const pid = live?.status === 'running' ? runnerMark(live)?.pid : undefined
  if (pid === undefined || !deps.isAlive(pid)) throw new Refused({ ok: false, reason: 'no-process', id }, `${id} has no process to stop yet, or its process died: look again in a moment`)
  deps.stop(pid)
  return { id }
}

/** A task as the command answers it, without its own words: the agent wrote those itself. */
function shownTask(one: PlanTask): Omit<PlanTask, 'body'> {
  const { body: _body, ...shown } = one
  return shown
}

/**
 * The caller's plan saved, the question to ask the person about it, and the tasks the command read
 * out of it. A text that is no task list is not saved: the caller fixes it before the person reads
 * it, since a plan the command cannot read is a plan no subagent can be started from.
 */
export async function savePlan(repo: string, env: NodeJS.ProcessEnv, text: string, deps: SubagentDeps): Promise<{ question: string; context?: string; check?: string; tasks: Omit<PlanTask, 'body'>[] }> {
  const main = await mainAgent(repo, env)
  if (runnerMark(main)?.parent !== undefined) throw new Refused({ ok: false, reason: 'subagent' }, 'a subagent has no plan: do the task yourself')
  const plan = parsePlan(text)
  if (plan.problems.length > 0) throw new Refused({ ok: false, reason: 'unreadable', problems: plan.problems }, plan.problems.join(' '))
  await writePlan(repo, main.id, text, deps.git)
  return { question: planQuestion(text), ...(plan.context !== undefined ? { context: plan.context } : {}), ...(plan.check !== undefined ? { check: plan.check } : {}), tasks: plan.tasks.map(shownTask) }
}

/** The caller's plan as it was last saved, its tasks, its question, and whether the person approved it. */
export async function showPlan(
  repo: string,
  env: NodeJS.ProcessEnv,
  deps: SubagentDeps,
): Promise<{ plan: string; question: string; approved: boolean; context?: string; check?: string; tasks: Omit<PlanTask, 'body'>[]; problems?: string[] }> {
  const main = await mainAgent(repo, env)
  const text = await readPlan(repo, main.id, deps.git)
  if (text === undefined) throw new Refused({ ok: false, reason: 'no-plan' }, 'no plan is saved')
  const plan = parsePlan(text)
  return {
    plan: text,
    question: planQuestion(text),
    approved: await planApproved(repo, main.id, text),
    ...(plan.context !== undefined ? { context: plan.context } : {}),
    ...(plan.check !== undefined ? { check: plan.check } : {}),
    tasks: plan.tasks.map(shownTask),
    ...(plan.problems.length > 0 ? { problems: plan.problems } : {}),
  }
}

/**
 * Land one of the caller's subagents: its branch merged into the branch the caller's checkout is
 * on, then deleted and taken off its record, so the work lives on the main agent's branch
 * alone. Origin is never touched: a subagent's branch is not published, and neither is anything
 * landing writes. A merge that conflicts is undone and refused: the main agent merges by
 * hand and lands again, which then only deletes. Nothing is deleted before the merge is in.
 *
 * What the subagent did is checked where it now is: the `Check:` line of its task runs in the main
 * agent's checkout after the merge, and the last land — the one after which every task of the plan
 * is landed — runs the plan's own check, the project's. Either failing is a refusal naming the
 * command and what it printed, with the merge left in and the branch left alive.
 *
 * The subagent's last commit outlives its branch: it is kept under {@link landedRef}, on this
 * machine, and written on its record as `landed`, beside the commit its work began at. The main
 * agent's branch is squashed and deleted one day, and what this one subagent changed is still read
 * from those two commits.
 */
export async function landSubagent(repo: string, env: NodeJS.ProcessEnv, id: string, deps: SubagentDeps): Promise<{ id: string; branch: string; merged: boolean; check?: string; projectCheck?: string }> {
  const { git } = deps
  const main = await mainAgent(repo, env)
  const card = await subagentOf(repo, main, id)
  if (card.status === 'running') throw new Refused({ ok: false, reason: 'running', id }, `${id} is still running: land it once it has ended`)
  const branch = card.branch
  if (branch === undefined) throw new Refused({ ok: false, reason: 'nothing-to-land', id }, `${id} left no branch: it committed nothing, or it is landed already`)
  const checkout = worktreePath(repo, main.id)
  if (!(await worktreeClean(checkout, git).catch(() => false))) throw new Refused({ ok: false, reason: 'uncommitted' }, 'your checkout has uncommitted changes: commit them, then land')

  // The subagent's own checkout, when it is still there, holds the branch: it goes first, and
  // only when it holds nothing uncommitted.
  const theirs = worktreePath(repo, id)
  const kept = await stat(theirs).then(s => s.isDirectory(), () => false)
  if (kept) {
    if (!(await worktreeClean(theirs, git).catch(() => false))) throw new Refused({ ok: false, reason: 'uncommitted-there', id, path: theirs }, `${id} left uncommitted changes in ${theirs}: commit them there on its branch, then land`)
  }

  const ref = `refs/heads/${branch}`
  const tip = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo).then(out => out.trim(), () => '')
  if (!tip) throw new Refused({ ok: false, reason: 'nothing-to-land', id }, `the branch ${branch} of ${id} is gone: there is nothing to land`)

  const merged = !(await git(['merge-base', '--is-ancestor', ref, 'HEAD'], checkout).then(() => true, () => false))
  if (merged) {
    try {
      await git(['merge', '--no-edit', '-m', `Merge branch '${branch}'`, ref], checkout)
    } catch (err) {
      const files = (await git(['diff', '--name-only', '--diff-filter=U'], checkout).catch(() => '')).split('\n').filter(Boolean)
      await git(['merge', '--abort'], checkout).catch(() => {})
      if (files.length === 0) throw new Error(`merging ${branch} failed: ${gitReason(err)}`)
      throw new Refused({ ok: false, reason: 'conflict', id, branch, files }, `merging ${branch} conflicts in ${files.join(', ')}: merge it yourself with \`git merge ${branch}\`, resolve, commit, and land again`)
    }
  }

  // The work is on the branch now, so the task's own check can run on it, before anything is
  // deleted or recorded as landed: a check that fails leaves the merge in and the branch alive, so
  // the main agent fixes it and lands again, which then only runs the check. A plan that is gone,
  // or that no longer holds the task this subagent did, has no check to run and is no refusal.
  const checks = await landChecks(repo, main.id, card, deps)
  for (const check of checks) {
    const ran = await deps.run(check.command, checkout)
    if (ran.code !== 0) throw new Refused({ ok: false, reason: check.reason, id, ...check.named, command: check.command, code: ran.code, ...cutOutput(ran.output) }, check.line(ran.code))
  }

  // Kept before anything is deleted: the commit must never be held by nothing.
  await git(['update-ref', landedRef(id), tip], repo)

  // Only an agent's branch is ever deleted, as in the branches package.
  const gone = isAgentBranch(branch)
  if (gone) {
    if (kept) await removeWorktree(repo, theirs, git)
    await git(['branch', '-D', branch], repo)
  }
  const { branch: _gone, ...branchless } = card
  const recorded = await recordRun(repo, { ...(gone ? branchless : card), caller: { ...card.caller, landed: tip } }, (await readDiary(repo, id)) ?? [])
  if (!recorded.ok && !recorded.committed) throw new Error(`the record of ${id} could not be written: ${recorded.error}`)
  const passed = Object.fromEntries(checks.map(check => [check.answer, check.command])) as { check?: string; projectCheck?: string }
  return { id, branch, merged, ...passed }
}

/** One check `land` runs, and how it refuses when the check fails. */
interface LandCheck {
  command: string
  /** What the answer of a land that passed it calls it. */
  answer: 'check' | 'projectCheck'
  reason: 'check' | 'project-check'
  named: Record<string, string>
  line: (code: number) => string
}

/**
 * What `land` runs on the main agent's checkout once the subagent's work is merged there: the
 * `Check:` line of the task that subagent did, and, when this land is the one after which every
 * task of the plan is landed, the plan's own `Check:` line, the project's checks. The project's are
 * not run on every land: they cost the whole project's build and tests once per task, and a plan
 * half landed has no reason to pass them.
 */
async function landChecks(repo: string, main: string, card: RunCard, deps: SubagentDeps): Promise<LandCheck[]> {
  const text = await readPlan(repo, main, deps.git)
  if (text === undefined) return []
  const plan = parsePlan(text)
  const id = card.id
  const task = plan.tasks.find(one => one.id === taskIdOf(card))
  const checks: LandCheck[] = []
  if (task?.check !== undefined)
    checks.push({
      command: task.check,
      answer: 'check',
      reason: 'check',
      named: { task: task.id },
      line: code =>
        `the check of "${task.name}", \`${task.check}\`, failed in your checkout with exit ${code} (its output is in the JSON): the merge is still in and the branch of ${id} is still there, so fix it on your branch, commit, and land ${id} again, which only runs the check — or retry the task with \`retry ${id} "<what to do differently>"\``,
    })
  // Landed as of this land: the one being landed counts, since nothing is recorded yet.
  const done = landedTasks(await subagentsOf(repo, main))
  if (task !== undefined) done.add(task.id)
  if (plan.check !== undefined && plan.tasks.every(one => done.has(one.id)))
    checks.push({
      command: plan.check,
      answer: 'projectCheck',
      reason: 'project-check',
      named: {},
      line: code =>
        `every task of the plan is landed and the plan's own check, \`${plan.check}\`, failed with exit ${code} (its output is in the JSON): the merge is still in and the branch of ${id} is still there, so fix it on your branch, commit, and land ${id} again`,
    })
  return checks
}

import { AGENT_ID_ENV, Refused, type GitRunner } from '@openagt/agent-data'
import { worktreePath } from '@openagt/skill-branches'
import { findRun, listRuns, type RunCard } from '@openagt/skill-logs'
import { readLiveCard, runnerMark } from '@openagt/agent-runner'
import { APPROVE, doneTasks, planApproved, planQuestion, readPlan } from './plan.js'
import { parsePlan, type Plan, type PlanTask } from './tasks.js'

/**
 * The caller of the command and what the records say of it: the main agent, the run whose agent
 * calls (`AGENT_ID`), its subagents, the runs started for it, and its plan as the person approved
 * it. What starting, landing and marking a task done each go by (`subagents.ts`, `land.ts`).
 */

/**
 * The run whose agent is calling: the one `AGENT_ID` names, by its record, or by the live card in
 * its checkout while its first record is still on its way to the branch.
 */
export async function mainAgent(repo: string, env: NodeJS.ProcessEnv): Promise<RunCard> {
  const id = env[AGENT_ID_ENV]?.trim()
  if (!id) throw new Refused({ ok: false, reason: 'not-a-run' }, `${AGENT_ID_ENV} is not set: only an agent started as a run has subagents; do the task yourself`)
  const card = (await findRun(repo, id)) ?? (await readLiveCard(worktreePath(repo, id), id))
  if (!card) throw new Refused({ ok: false, reason: 'not-a-run', id }, `no run ${id} in this project: only an agent started as a run has subagents; do the task yourself`)
  return card
}

/** One of the caller's subagents, by id. */
export async function subagentOf(repo: string, main: RunCard, id: string): Promise<RunCard> {
  const card = await findRun(repo, id)
  if (!card || runnerMark(card)?.parent !== main.id) throw new Refused({ ok: false, reason: 'not-yours', id }, `${id} is not a subagent of this run`)
  return card
}

/** Every subagent of the caller, newest first, as the records say. */
export async function subagentsOf(repo: string, main: string): Promise<RunCard[]> {
  return (await listRuns(repo)).filter(card => runnerMark(card)?.parent === main)
}

/** The task of the plan a subagent was started on, as `start` wrote it on its record. */
export function taskIdOf(card: RunCard): string | undefined {
  const task = card.caller?.['task']
  return typeof task === 'string' ? task : undefined
}

/** Whether a subagent's work is on the main agent's branch: `land` wrote the commit it landed. */
export function landed(card: RunCard): boolean {
  return typeof card.caller?.['landed'] === 'string'
}

/** The tasks of the plan the caller has landed. */
function landedTasks(mine: readonly RunCard[]): Set<string> {
  return new Set(mine.flatMap(card => (landed(card) ? [taskIdOf(card) ?? ''] : [])))
}

/**
 * The tasks of the plan whose work is on the caller's branch: the ones a subagent of it landed, and
 * the ones the caller marked done itself. Either is finished for every rule that waits on a task.
 */
export async function finishedTasks(repo: string, main: string, mine: readonly RunCard[]): Promise<{ landed: Set<string>; done: Set<string>; finished: Set<string> }> {
  const landed = landedTasks(mine)
  const done = await doneTasks(repo, main)
  return { landed, done, finished: new Set([...landed, ...done]) }
}

/** The caller's subagents on one task, newest first. */
export function runsOn(mine: readonly RunCard[], task: string): RunCard[] {
  return mine.filter(card => taskIdOf(card) === task)
}

/** The task of the caller's plan that `id` names; a refusal naming the plan's tasks when it names none. */
export function planTask(plan: Plan, id: string): PlanTask {
  const task = plan.tasks.find(one => one.id === id)
  if (task !== undefined) return task
  const tasks = plan.tasks.map(one => one.id)
  throw new Refused({ ok: false, reason: 'no-task', task: id, tasks }, `your plan has no task "${id}": its tasks are ${tasks.join(', ')}`)
}

/** The caller's plan, saved and approved by the person as it is saved now; either missing is a refusal of its own. */
export async function approvedPlan(repo: string, main: string, git: GitRunner): Promise<Plan> {
  const text = await readPlan(repo, main, git)
  if (text === undefined) throw new Refused({ ok: false, reason: 'no-plan' }, 'no plan is saved: save your plan with `orchestration plan <file>` and ask the person the question it answers, before any subagent starts')
  if (!(await planApproved(repo, main, text))) {
    const question = planQuestion(text)
    throw new Refused({ ok: false, reason: 'not-approved', question }, `the person has not approved the saved plan: ask them "${question}" with the option "${APPROVE}", end your reply there, and start once they chose it`)
  }
  return parsePlan(text)
}

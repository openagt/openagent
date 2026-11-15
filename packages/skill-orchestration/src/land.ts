import { stat } from 'node:fs/promises'
import { Refused, gitReason } from '@openagt/agent-data'
import { isAgentBranch, removeWorktree, worktreeClean, worktreePath } from '@openagt/skill-branches'
import { readDiary, type RunCard } from '@openagt/skill-logs'
import { recordRun, runnerMark } from '@openagt/agent-runner'
import { approvedPlan, finishedTasks, landed, mainAgent, planTask, runsOn, subagentOf, subagentsOf, taskIdOf } from './caller.js'
import { markDone, readPlan } from './plan.js'
import { parsePlan, type Plan, type PlanTask } from './tasks.js'
import { cutOutput } from './check.js'
import type { SubagentDeps } from './subagents.js'

/**
 * A task's work reaching the main agent's branch: a subagent's by landing, merged there and its own
 * branch gone, and a task the main agent kept by marking it done. Either runs the checks that say
 * the work holds: the task's own, and the plan's once the last task is finished.
 * What a subagent itself changed stays readable for good: its last commit is kept under a ref of
 * its own and named on its record.
 */

/** The ref a landed subagent's last commit is kept under, on this machine, so git never drops it. */
export function landedRef(id: string): string {
  return `refs/landed/${id}`
}

/**
 * Land one of the caller's subagents: its branch merged into the branch the caller's checkout is
 * on, then deleted and taken off its record, so the work lives on the main agent's branch
 * alone. Origin is never touched: a subagent's branch is not published, and neither is anything
 * landing writes. A merge that conflicts is undone and refused: the main agent merges by
 * hand and lands again, which then only deletes. Nothing is deleted before the merge is in.
 *
 * What the subagent did is checked where it now is: the `Check:` line of its task runs in the main
 * agent's checkout after the merge, and a land after which every task of the plan is landed or
 * done by the main agent runs the plan's own check, the project's. Either failing is a refusal naming the
 * command and what it printed, with the merge left in and the branch left alive.
 *
 * The subagent's last commit outlives its branch: it is kept under {@link landedRef}, on this
 * machine, and written on its record as `landed`, beside the commit its work began at. The main
 * agent's branch is squashed and deleted one day, and what this one subagent changed is still read
 * from those two commits.
 */
export async function landSubagent(repo: string, env: NodeJS.ProcessEnv, id: string, deps: SubagentDeps): Promise<{ id: string; branch: string; merged: boolean; check?: string; projectCheck?: string; unchecked?: Unchecked }> {
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
  const { checks, unchecked } = await landChecks(repo, main.id, card, deps)
  const passed = await runChecks(checks, checkout, { id }, deps)

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
  return { id, branch, merged, ...passed, ...(unchecked !== undefined ? { unchecked } : {}) }
}

/**
 * Why a land ran no check of the task's: the record does not say which task the subagent did (a run
 * from before the task was written on records, or one whose record lost it), the plan no longer
 * holds that task, or the task names no `Check:` line. Said in the answer so a land that checked
 * nothing cannot be read as a land that checked and passed.
 */
export type Unchecked = 'no-plan' | 'no-task-on-record' | 'task-gone' | 'no-check-line'

/** One check `land` or `done` runs, and how it refuses when the check fails. */
interface CheckToRun {
  command: string
  /** What the answer of a command that passed it calls it. */
  answer: 'check' | 'projectCheck'
  reason: 'check' | 'project-check'
  named: Record<string, string>
  line: (code: number) => string
}

/** A task's own `Check:` line; `then` tells the main agent what to do when it fails. */
function taskCheck(task: PlanTask, command: string, then: string): CheckToRun {
  return {
    command,
    answer: 'check',
    reason: 'check',
    named: { task: task.id },
    line: code => `the check of "${task.name}", \`${command}\`, failed in your checkout with exit ${code} (its output is in the JSON): ${then}`,
  }
}

/**
 * The plan's own `Check:` line, the project's checks, when every task of the plan is finished:
 * landed by a subagent or done by the main agent. Not before: they cost the whole project's build
 * and tests, and a plan half finished has no reason to pass them.
 */
function projectCheck(plan: Plan, finished: ReadonlySet<string>, then: string): CheckToRun | undefined {
  const command = plan.check
  if (command === undefined || !plan.tasks.every(one => finished.has(one.id))) return undefined
  return {
    command,
    answer: 'projectCheck',
    reason: 'project-check',
    named: {},
    line: code => `every task of the plan is landed or done and the plan's own check, \`${command}\`, failed with exit ${code} (its output is in the JSON): ${then}`,
  }
}

/**
 * The checks that finishing `task` runs: its own `Check:` line, then the plan's when `task` is the
 * last of the plan to be finished (`finished` counts it already). Each says `then` when it fails.
 */
function checksOf(plan: Plan, task: PlanTask | undefined, finished: ReadonlySet<string>, then: { task: string; plan: string }): CheckToRun[] {
  const project = projectCheck(plan, finished, then.plan)
  return [...(task?.check !== undefined ? [taskCheck(task, task.check, then.task)] : []), ...(project !== undefined ? [project] : [])]
}

/** Run each check in the main agent's checkout, in turn; the first that fails is a refusal naming the command and what it printed. */
async function runChecks(checks: readonly CheckToRun[], checkout: string, named: Record<string, string>, deps: SubagentDeps): Promise<{ check?: string; projectCheck?: string }> {
  for (const check of checks) {
    const ran = await deps.run(check.command, checkout)
    if (ran.code !== 0) throw new Refused({ ok: false, reason: check.reason, ...named, ...check.named, command: check.command, code: ran.code, ...cutOutput(ran.output) }, check.line(ran.code))
  }
  return Object.fromEntries(checks.map(check => [check.answer, check.command])) as { check?: string; projectCheck?: string }
}

/**
 * What `land` runs on the main agent's checkout once the subagent's work is merged there: the
 * `Check:` line of the task that subagent did, and, when this land is one after which every task of
 * the plan is finished, the plan's own `Check:` line, the project's checks.
 *
 * When there is no task check to run, it says why rather than nothing: a land that answered `ok`
 * and silently checked nothing read as a land that checked and passed, and an agent reported its
 * tasks as checked when none of them had been.
 */
async function landChecks(repo: string, main: string, card: RunCard, deps: SubagentDeps): Promise<{ checks: CheckToRun[]; unchecked?: Unchecked }> {
  const text = await readPlan(repo, main, deps.git)
  if (text === undefined) return { checks: [], unchecked: 'no-plan' }
  const plan = parsePlan(text)
  const id = card.id
  const task = plan.tasks.find(one => one.id === taskIdOf(card))
  // Finished as of this land: the one being landed counts, since nothing is recorded yet.
  const { finished } = await finishedTasks(repo, main, await subagentsOf(repo, main))
  if (task !== undefined) finished.add(task.id)
  const again = `the merge is still in and the branch of ${id} is still there, so fix it on your branch, commit, and land ${id} again`
  const checks = checksOf(plan, task, finished, { task: `${again}, which only runs the check — or retry the task with \`retry ${id} "<what to do differently>"\``, plan: again })
  const unchecked: Unchecked | undefined = task === undefined ? (taskIdOf(card) === undefined ? 'no-task-on-record' : 'task-gone') : task.check === undefined ? 'no-check-line' : undefined
  return { checks, ...(unchecked !== undefined ? { unchecked } : {}) }
}

/**
 * Mark a task of the plan done by the main agent itself: the counterpart of landing a subagent, for
 * a task the main agent kept — an uncertain one above all, which no subagent may take. The mark
 * goes in the main agent's own log, and from then on the task is finished for every rule that waits
 * on one: `next` says `done`, a task that `Needs:` it may start, and the plan's own check runs once
 * every task is landed or done, on whichever `land` or `done` finishes the plan.
 *
 * Like a land, it runs the task's own `Check:` line, and the plan's when it is the last, on the
 * work as it is committed, and a check that fails is a refusal that marks nothing: the main agent
 * fixes it, commits, and marks it again. A mark is never taken back, as a land is not: the work is
 * on the main agent's branch, and nothing undoes it there.
 */
export async function markTaskDone(repo: string, env: NodeJS.ProcessEnv, which: string, deps: SubagentDeps): Promise<{ task: string; name: string; check?: string; projectCheck?: string; unchecked?: 'no-check-line' }> {
  const main = await mainAgent(repo, env)
  if (runnerMark(main)?.parent !== undefined) throw new Refused({ ok: false, reason: 'subagent' }, 'a subagent has no plan: say in your last reply what you did')
  const plan = await approvedPlan(repo, main.id, deps.git)
  const task = planTask(plan, which)
  const mine = await subagentsOf(repo, main.id)
  const runs = runsOn(mine, task.id)
  const lander = runs.find(landed)
  if (lander !== undefined) throw new Refused({ ok: false, reason: 'landed', task: task.id, id: lander.id }, `the task "${task.name}" is landed already: ${lander.id} did it, so there is nothing to mark`)
  const tasks = await finishedTasks(repo, main.id, mine)
  if (tasks.done.has(task.id)) throw new Refused({ ok: false, reason: 'done', task: task.id }, `you marked the task "${task.name}" done already`)
  // Two agents on one task: the subagent's work would land over the work marked done.
  const running = runs.find(card => card.status === 'running')
  if (running !== undefined) throw new Refused({ ok: false, reason: 'running', task: task.id, id: running.id }, `${running.id} is running the task "${task.name}": wait for it and land it, or stop it, before you mark the task done yourself`)
  // The work is done when it is committed: the checks run on what is, and a subagent that needs this
  // task starts from the branch's last commit.
  const checkout = worktreePath(repo, main.id)
  if (!(await worktreeClean(checkout, deps.git).catch(() => false))) throw new Refused({ ok: false, reason: 'uncommitted' }, 'your checkout has uncommitted changes: commit your work on the task, then mark it done')
  const again = `fix it on your branch, commit, and mark it with \`done ${task.id}\` again; nothing is marked yet`
  tasks.finished.add(task.id)
  const passed = await runChecks(checksOf(plan, task, tasks.finished, { task: again, plan: again }), checkout, { task: task.id }, deps)
  await markDone(repo, main.id, task.id, deps.now().toISOString())
  return { task: task.id, name: task.name, ...passed, ...(task.check === undefined ? { unchecked: 'no-check-line' as const } : {}) }
}

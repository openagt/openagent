import { stat } from 'node:fs/promises'
import { errorMessage, nodeGitRunner, sessionsHome, type GitRunner } from '@openagt/agent-data'
import { defineModule, RunOrder, type ModuleDefinition, type RunContext } from '@openagt/hooks'
import { agentBranchName } from './branch-names.js'
import { attachCheckout, createCheckout } from './checkout.js'
import { reclaimWorktree } from './reclaim.js'
import { copiesLine, openSessionFolder, SESSION_FOLDER_STAYS } from './session-folder.js'
import { worktreeBranch, worktreePath, type AddedWorktree } from './worktree.js'

/**
 * git-branches, the module (#2394): where a run works, made before anything is linked into it;
 * the branch the agent left its work on, read back once its turns are over; and the checkout
 * reclaimed once the record says how the run ended. What it finds out is in the run's facts
 * (`RunFacts['git-branches']`), which the run's record keeps and a resume starts from.
 */

/** What the module works with; the real one when absent. */
export interface GitBranchesDeps {
  git?: GitRunner
}

export function gitBranchesModule(deps: GitBranchesDeps = {}): ModuleDefinition {
  const git = deps.git ?? nodeGitRunner()
  return defineModule({
    name: 'git-branches',
    hooks: {
      'run.step': [
        { order: RunOrder.WORKSPACE, name: 'make the checkout', run: ctx => makeCheckout(ctx, git) },
        { order: RunOrder.RECORD - 20, name: 'read the branch back', run: ctx => readBranch(ctx, git) },
        { order: RunOrder.CLEANUP, name: 'reclaim the checkout', run: ctx => reclaim(ctx, git) },
      ],
    },
  })
}

export default gitBranchesModule()

/**
 * Where the run works: for a run with no project, a folder of its own in the sessions home, with
 * a copy of each of its repos; else a checkout of the project, the branches package's one
 * sequence, on a fresh branch or on the one the run was given. A continued run goes on in the
 * checkout it kept, or in a new one attached to its branch. A run in a project has the copies of
 * its repos too, in a session's folder beside its checkout, and its prompt says where each one
 * made now is: the agent starts in the checkout, and would not find them.
 *
 * A run that makes its own branch writes down the commit the branch was made at, kept for its
 * whole life: the run's own work is what came after it, which is how it is still told apart once
 * it is merged. A branch the run was given holds another run's work, begun elsewhere, and a branch
 * a continued run still has holds its own, so neither writes one; a branch that was gone
 * everywhere, made again from where its base is now, writes the new one.
 */
async function makeCheckout(ctx: RunContext, git: GitRunner): Promise<void> {
  const options = ctx.options['git-branches'] ?? {}
  if (!ctx.project) {
    ctx.workspace = (await openSessionFolder(sessionsHome(), ctx.id, options.repos, git)).path
    return
  }
  const { dir } = ctx.project
  const before = ctx.facts['git-branches'] ?? {}
  if (ctx.resume) {
    const checkout = await keptCheckout(dir, ctx.id, before.branch, options.base, git)
    ctx.workspace = checkout.path
    ctx.facts['git-branches'] = { ...before, branch: checkout.branch, ...(checkout.again ? { again: true, ...(await startCommit(checkout.path, git)) } : {}) }
  } else {
    const checkout =
      options.branch !== undefined
        ? await attachCheckout(dir, { agentId: ctx.id, branch: options.branch }, git)
        : await createCheckout(dir, { agentId: ctx.id, ...(options.base !== undefined ? { base: options.base } : {}) }, git)
    ctx.workspace = checkout.path
    ctx.facts['git-branches'] = { branch: checkout.branch, ...(options.branch === undefined ? await startCommit(checkout.path, git) : {}) }
  }
  if (options.repos === undefined || options.repos.length === 0) return
  const copies = await openSessionFolder(sessionsHome(), ctx.id, options.repos, git)
  if (copies.made.length > 0) ctx.context.push(copiesLine(copies.path, ctx.id, copies.made))
}

/**
 * A continued run's checkout: the one it kept, or a new one attached to its branch; a branch that
 * went with the checkout, for holding nothing, starts again from `base`, or origin's default branch.
 */
async function keptCheckout(dir: string, id: string, branch: string | undefined, base: string | undefined, git: GitRunner): Promise<AddedWorktree> {
  const on = branch ?? agentBranchName(id)
  const path = worktreePath(dir, id)
  if (await stat(path).then(s => s.isDirectory(), () => false)) return { path, branch: on }
  return attachCheckout(dir, { agentId: id, branch: on, ...(base !== undefined ? { base } : {}) }, git)
}

/** The commit a checkout just made is at: where the run's own work begins. Nothing when git cannot say. */
async function startCommit(checkout: string, git: GitRunner): Promise<{ baseCommit?: string }> {
  const commit = (await git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], checkout).catch(() => '')).trim()
  return commit ? { baseCommit: commit } : {}
}

/** The branch the agent left its work on: it renames its branch itself. A session's folder has none. */
async function readBranch(ctx: RunContext, git: GitRunner): Promise<void> {
  const facts = ctx.facts['git-branches']
  if (facts?.branch === undefined || ctx.workspace === undefined) return
  facts.branch = (await worktreeBranch(ctx.workspace, git).catch(() => undefined)) ?? facts.branch
}

/**
 * The checkout goes once its branch holds everything in it (the branches rule), and the branch
 * stays on this machine: nothing is pushed here, publishing is the agent's when it was asked, the
 * person's otherwise. A dirty tree keeps the checkout, and the sweep tries again later. A waiting
 * run keeps it on purpose: the answer resumes the run there. A session's folder is its work, kept
 * for the person and for the run going on later.
 */
async function reclaim(ctx: RunContext, git: GitRunner): Promise<void> {
  const facts = (ctx.facts['git-branches'] ??= {})
  if (ctx.workspace === undefined) facts.reclaimed = { reclaimed: false, reason: 'no checkout' }
  else if (ctx.outcome?.status === 'waiting') facts.reclaimed = { reclaimed: false, reason: 'waiting' }
  else if (!ctx.project) facts.reclaimed = { reclaimed: false, reason: SESSION_FOLDER_STAYS }
  else {
    const from = facts.baseCommit
    const reclaimed = await reclaimWorktree(ctx.project.dir, ctx.workspace, { birthBranch: agentBranchName(ctx.id), ...(from !== undefined ? { from } : {}), git }).catch(
      (err: unknown) => ({ ok: false, reason: errorMessage(err) }) as const,
    )
    facts.reclaimed = reclaimed.ok ? { reclaimed: true, ...(reclaimed.branchesDeleted ? { deleted: reclaimed.branchesDeleted } : {}) } : { reclaimed: false, reason: reclaimed.reason }
  }
}

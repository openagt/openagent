import { stat } from 'node:fs/promises'
import { errorMessage, type GitRunner } from '@openagt/agent-data'
import { agentBranchName, attachCheckout, createCheckout, reclaimWorktree, worktreeBranch, worktreePath } from '@openagt/skill-branches'
import { RunOrder, type RunContext, type RunStep } from '@openagt/hooks'
import type { Leg, Workspace } from '../leg.js'
import { openSessionFolder, SESSION_FOLDER_STAYS } from '../session-folder.js'

/**
 * git-branches' steps: where the run works, made before anything is linked into it; the branch
 * the agent left its work on, read back once its turns are over; and the checkout reclaimed once
 * the record says how the run ended.
 */
export function gitBranchesSteps(leg: Leg): RunStep[] {
  return [
    { order: RunOrder.WORKSPACE, name: 'make the checkout', run: ctx => makeCheckout(leg, ctx) },
    { order: RunOrder.RECORD - 20, name: 'read the branch back', run: () => readBranch(leg) },
    { order: RunOrder.CLEANUP, name: 'reclaim the checkout', run: ctx => reclaim(leg, ctx) },
  ]
}

/**
 * Where the run works: a session's own folder, for a run with no project; else a checkout of the
 * project, the branches package's one sequence, on a fresh branch or the one the run was given. A
 * continued run goes on in the checkout it kept, or in a new one attached to its branch.
 *
 * A run that makes its own branch writes down the commit the branch was made at, on its mark for
 * its whole life: the run's own work is what came after it, which is how it is still told apart
 * once it is merged. A branch the run was given holds another run's work, begun elsewhere, and a
 * branch a continued run still has holds its own, so neither writes one; a branch that was gone
 * everywhere, made again from where its base is now, writes the new one.
 */
async function makeCheckout(leg: Leg, ctx: RunContext): Promise<void> {
  const { repo, id, here, mark } = leg
  const checkout: Workspace =
    leg.sessions !== undefined
      ? await openSessionFolder(leg.sessions, id, mark.repos, here.git)
      : leg.earlier !== undefined
        ? await keptCheckout(repo, id, leg.card.branch, mark.base, here.git)
        : leg.branch !== undefined
          ? await attachCheckout(repo, { agentId: id, branch: leg.branch }, here.git)
          : await createCheckout(repo, { agentId: id, ...(mark.base !== undefined ? { base: mark.base } : {}) }, here.git)
  leg.checkout = checkout
  ctx.workspace = checkout.path
  const ownBranch = leg.earlier !== undefined ? checkout.again === true : checkout.branch !== undefined && leg.branch === undefined
  if (ownBranch) leg.mark = { ...leg.mark, ...(await startCommit(checkout.path, here.git)) }
}

/**
 * A continued run's checkout: the one it kept, or a new one attached to its branch; a branch that
 * went with the checkout, for holding nothing, starts again from `base`, or origin's default branch.
 */
async function keptCheckout(repo: string, id: string, branch: string | undefined, base: string | undefined, git: GitRunner): Promise<Workspace> {
  const on = branch ?? agentBranchName(id)
  const path = worktreePath(repo, id)
  if (await stat(path).then(s => s.isDirectory(), () => false)) return { path, branch: on }
  return attachCheckout(repo, { agentId: id, branch: on, ...(base !== undefined ? { base } : {}) }, git)
}

/** The commit a checkout just made is at: where the run's own work begins. Nothing when git cannot say. */
async function startCommit(checkout: string, git: GitRunner): Promise<{ baseCommit?: string }> {
  const commit = (await git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], checkout).catch(() => '')).trim()
  return commit ? { baseCommit: commit } : {}
}

/** The branch the agent left its work on: it renames its branch itself. A session's folder has none. */
async function readBranch(leg: Leg): Promise<void> {
  const checkout = leg.checkout
  if (checkout?.branch === undefined) return
  leg.worked.branch = (await worktreeBranch(checkout.path, leg.here.git).catch(() => undefined)) ?? checkout.branch
}

/**
 * The checkout goes once its branch holds everything in it (the branches rule), and the branch
 * stays on this machine: nothing is pushed here, publishing is the agent's when it was asked, the
 * person's otherwise. A dirty tree keeps the checkout, and the sweep tries again later. A waiting
 * run keeps it on purpose: the answer resumes the run there. A session's folder is its work, kept
 * for the person and for the run going on later.
 */
async function reclaim(leg: Leg, ctx: RunContext): Promise<void> {
  const checkout = leg.checkout
  if (!checkout) leg.reclaimed = { reclaimed: false, reason: 'no checkout' }
  else if (ctx.outcome?.status === 'waiting') leg.reclaimed = { reclaimed: false, reason: 'waiting' }
  else if (checkout.branch === undefined) leg.reclaimed = { reclaimed: false, reason: SESSION_FOLDER_STAYS }
  else {
    const from = leg.mark.baseCommit
    const reclaimed = await reclaimWorktree(leg.repo, checkout.path, { birthBranch: agentBranchName(leg.id), ...(from !== undefined ? { from } : {}), git: leg.here.git }).catch(
      (err: unknown) => ({ ok: false, reason: errorMessage(err) }) as const,
    )
    leg.reclaimed = reclaimed.ok ? { reclaimed: true } : { reclaimed: false, reason: reclaimed.reason }
    if (reclaimed.ok && reclaimed.branchesDeleted) leg.deleted = reclaimed.branchesDeleted
  }
}

import { gitReason, nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { isAgentBranch } from './branch-names.js'
import { checkoutOn, currentBranch, worktreeClean } from './worktree.js'

/**
 * Merging a finished agent's branch into the project's default branch, on this machine: how the
 * work reaches the project's own folder where there is no remote to push to and no pull request
 * to merge. Git only, like the push: the merge runs in the project's folder, which must be on the
 * default branch.
 *
 * Nothing is left half done. A merge that conflicts is undone and the files it conflicted in are
 * named; nothing is committed on the agent's behalf, so a checkout with uncommitted work stops
 * the merge before it starts. Once the work is in, the agent's branch goes, since the default
 * branch holds everything it held; a branch whose checkout is still there is kept with it.
 */

/** Why a branch was not merged. */
export type MergeRefusal =
  /** This machine has no such branch. */
  | 'no-branch'
  /** The project has no default branch to merge into. */
  | 'no-default-branch'
  /** The project's folder is on another branch than the default one. */
  | 'not-on-default'
  /** The agent's checkout holds uncommitted work. */
  | 'dirty'
  /** The branch and the default branch changed the same lines; nothing was changed. */
  | 'conflict'
  /** Git refused the merge for another reason (uncommitted changes in the project's folder it would overwrite); nothing was changed. */
  | 'merge-failed'

export type MergeOutcome =
  /**
   * `commit` is the branch's last commit and `from` the commit its work began at (where it left
   * the default branch): what the branch changed is read between the two once the branch is
   * gone. `deleted` is false for a branch that is no agent's, which is never deleted, and for one
   * whose checkout is still there.
   */
  | { ok: true; branch: string; into: string; commit: string; from: string; deleted: boolean }
  | { ok: false; reason: 'no-branch' | 'dirty'; branch: string }
  | { ok: false; reason: 'no-default-branch'; branch: string }
  | { ok: false; reason: 'not-on-default'; branch: string; into: string; current?: string }
  | { ok: false; reason: 'conflict'; branch: string; into: string; files: string[] }
  | { ok: false; reason: 'merge-failed'; branch: string; into: string; detail: string }

/** The project's default branch, as a local branch: what origin's HEAD names, else the first local conventional one. */
async function defaultBranch(repo: string, git: GitRunner): Promise<string | undefined> {
  const head = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repo).then(out => out.trim().replace(/^origin\//, ''), () => '')
  for (const name of [head, 'main', 'master']) {
    if (name && (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], repo).then(out => out.trim() !== '', () => false))) return name
  }
  return undefined
}

/** Merge `branch` into the project's default branch, in the project's folder, then delete the branch when it is an agent's. */
export async function mergeBranch(repo: string, branch: string, git: GitRunner = nodeGitRunner()): Promise<MergeOutcome> {
  const ref = `refs/heads/${branch}`
  const commit = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo).then(out => out.trim(), () => '')
  if (!commit) return { ok: false, reason: 'no-branch', branch }
  const into = await defaultBranch(repo, git)
  if (!into) return { ok: false, reason: 'no-default-branch', branch }
  const current = await currentBranch(repo, git)
  if (current !== into) return { ok: false, reason: 'not-on-default', branch, into, ...(current ? { current } : {}) }

  // The agent's own checkout, when it is still there, holds the branch: what is merged is what is committed.
  const checkout = await checkoutOn(repo, branch, git)
  if (checkout && !(await worktreeClean(checkout, git).catch(() => false))) return { ok: false, reason: 'dirty', branch }

  const from = (await git(['merge-base', into, commit], repo)).trim()
  if (from !== commit) {
    try {
      await git(['merge', '--no-edit', '-m', `Merge branch '${branch}'`, ref], repo)
    } catch (err) {
      const files = (await git(['diff', '--name-only', '--diff-filter=U'], repo).catch(() => '')).split('\n').filter(Boolean)
      await git(['merge', '--abort'], repo).catch(() => {})
      if (files.length > 0) return { ok: false, reason: 'conflict', branch, into, files }
      return { ok: false, reason: 'merge-failed', branch, into, detail: gitReason(err) }
    }
  }

  // Only an agent's branch is ever deleted, and only now that the default branch holds it. A
  // branch that still has its checkout is left with it: an agent may be working there (one asked
  // to merge its own work runs this from inside it), and removing the checkout under it would
  // take its diary with it. The checkout's owner reclaims both, by the reclaim rule.
  const deleted = isAgentBranch(branch) && checkout === undefined
  if (deleted) await git(['branch', '-D', branch], repo)
  return { ok: true, branch, into, commit, from, deleted }
}

import { nodeGitRunner, originDefaultBranch, type GitRunner } from '@openagt/agent-data'
import { isAgentBranch } from './branch-names.js'
import {
  currentBranch,
  deleteBranch,
  isWorktreeRoot,
  pruneWorktrees,
  removeWorktree,
  worktreeClean,
} from './worktree.js'

/**
 * Reclaiming a checkout (#752/#737): the one implementation behind every surface that removes
 * one — a scheduler at a run's end and in its sweep, a dashboard's Remove button, the CLI.
 *
 * **One rule: only what is committed may go.** The checkout is removed only once its branch holds
 * everything in it: a clean tree. The branch stays on this machine, so nothing the agent made
 * goes with the checkout. Nothing is committed on the agent's behalf (#1638): a checkout holding
 * uncommitted work is kept, until a person commits or deletes it. And nothing is pushed:
 * publishing a branch is a person's call, never a cleanup's.
 *
 * What the caller knows and git does not comes in as options: the branch the checkout was created
 * on, and the commit its branch was made at.
 */
export interface ReclaimOptions {
  /**
   * The branch the checkout was created on, when that may differ from the branch it ended on: an
   * agent that branched away leaves it behind, and it goes with the checkout once the branch the
   * checkout ended on contains it (#1657).
   */
  birthBranch?: string
  /**
   * The commit the checkout's branch was made at, when the caller knows it. A branch with no
   * commit past it holds nothing of its own.
   */
  from?: string
  /** Run once removal is decided, just before the checkout goes: stop what serves the tree. */
  beforeRemove?: () => Promise<void>
  git?: GitRunner
}

/** Why {@link reclaimWorktree} left a checkout where it was. */
export type ReclaimRefusal =
  /** The directory is not a git worktree root: nothing was run in it (#1654). */
  | 'not-a-worktree'
  /** The checkout is on no branch (detached). */
  | 'no-branch'
  /** The tree holds uncommitted work. */
  | 'dirty'

export type ReclaimOutcome =
  | {
      ok: true
      /**
       * Branches that went with the checkout: the branch it was on, when that held nothing of
       * its own (#1650); the birth branch, when everything on it is in the branch that stays
       * (#1657). Absent when nothing went.
       */
      branchesDeleted?: string[]
    }
  | { ok: false; reason: 'not-a-worktree' | 'no-branch' }
  | {
      ok: false
      reason: 'dirty'
      /** The branch the checkout is on. */
      branch: string
    }

/**
 * Remove one checkout under the rule above. Throws only for a git failure past the decision
 * (the removal itself); every refusal is an outcome.
 */
export async function reclaimWorktree(repo: string, path: string, opts: ReclaimOptions): Promise<ReclaimOutcome> {
  const git = opts.git ?? nodeGitRunner()
  // Before any git runs in it (#1654): a directory under `.branches/` that git does not know as
  // a worktree root makes every command below act on the enclosing repo — the user's checkout,
  // the user's branch. Nothing is pushed or deleted through it; it is left where it is.
  if (!(await isWorktreeRoot(path, git))) return { ok: false, reason: 'not-a-worktree' }
  const branch = await currentBranch(path, git)
  if (!branch) return { ok: false, reason: 'no-branch' }
  // Every way out below needs a clean tree: `removeWorktree` forces past a dirty one, so a dirty
  // tree is kept (#1638), and so is a tree git cannot read. Asked once, for all of them.
  if (!(await worktreeClean(path, git).catch(() => false))) return { ok: false, reason: 'dirty', branch }

  // Whether the checkout's branch goes with it (#1650): only when it holds no commit of its own —
  // an agent that committed nothing — and only a branch minted for an agent: a leftover checkout
  // can sit on the user's own branch (one was found on `main`), and deleting that is not this
  // code's call even when it holds nothing — git's refusal to delete a checked-out branch must
  // never be the guard.
  const emptyBranch = isAgentBranch(branch) && (await branchHoldsNothing(repo, branch, opts.from, git))

  // The birth branch (#1657) is judged before anything is deleted: the containment reads both refs.
  // Only a branch the package minted: the rule that guards the checkout's own branch guards this one.
  const birthBranchGoes =
    opts.birthBranch !== undefined && opts.birthBranch !== branch && isAgentBranch(opts.birthBranch) && (await isAncestor(repo, `refs/heads/${opts.birthBranch}`, `refs/heads/${branch}`, git))
  await opts.beforeRemove?.()
  await removeWorktree(repo, path, git)
  await pruneWorktrees(repo, git)
  // After the checkout: git refuses to delete a branch a worktree still has checked out.
  // Only a branch that actually went is named: git refuses to delete a branch another worktree
  // has checked out, and the caller must not report that one as gone.
  const deleted: string[] = []
  if (emptyBranch && (await deleteBranch(repo, branch, git))) deleted.push(branch)
  if (birthBranchGoes && opts.birthBranch && (await deleteBranch(repo, opts.birthBranch, git))) deleted.push(opts.birthBranch)
  return deleted.length ? { ok: true, branchesDeleted: deleted } : { ok: true }
}

/**
 * Discard one checkout (#1774): it goes whatever it holds, uncommitted work included. A person's
 * call, for a run they are throwing away, where the rule above would keep the checkout. The
 * branch and its commits stay: deleting a branch that may carry an open pull request is git's
 * business, never this tool's on the way out of a checkout. Only the not-a-worktree guard
 * applies: a directory git does not know as a worktree is left alone.
 */
export async function discardWorktree(repo: string, path: string, opts: Pick<ReclaimOptions, 'git' | 'beforeRemove'> = {}): Promise<{ ok: true } | { ok: false; reason: 'not-a-worktree' }> {
  const git = opts.git ?? nodeGitRunner()
  if (!(await isWorktreeRoot(path, git))) return { ok: false, reason: 'not-a-worktree' }
  await opts.beforeRemove?.()
  await git(['worktree', 'remove', '--force', path], repo)
  await pruneWorktrees(repo, git)
  return { ok: true }
}

/**
 * Whether a branch holds nothing of its own (#1650). Either answer is enough: it has no commit
 * past the commit it was made at, when the caller names that commit and this machine has it; or
 * origin's default branch already has everything on it, read from the local remote-tracking ref
 * and never fetched. The first is the only one a project with no remote can give, and the only
 * one for a branch made from another branch nobody published. The second is the only one for a
 * caller that names no commit, and for a branch whose work was merged.
 *
 * Not "the tip is on the remote under another name", the earlier test: a branch another agent was
 * started from has its tip inside that agent's branch once that one is pushed, and it is still
 * the only branch that work is its own on.
 */
async function branchHoldsNothing(repo: string, branch: string, from: string | undefined, git: GitRunner): Promise<boolean> {
  const tip = `refs/heads/${branch}`
  if (from !== undefined) {
    // The commit itself, never the caller's words handed on to git; one this machine lacks proves nothing.
    const start = await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${from}^{commit}`], repo).then(out => out.trim(), () => '')
    if (start !== '' && (await isAncestor(repo, tip, start, git))) return true
  }
  const main = await originDefaultBranch(repo, git)
  return main !== undefined && (await isAncestor(repo, tip, `refs/remotes/${main}`, git))
}

/** Whether `inner` is `outer` or an ancestor of it — everything on it is on `outer` too. False on any doubt. */
async function isAncestor(cwd: string, inner: string, outer: string, git: GitRunner): Promise<boolean> {
  return git(['merge-base', '--is-ancestor', inner, outer], cwd).then(
    () => true,
    () => false,
  )
}

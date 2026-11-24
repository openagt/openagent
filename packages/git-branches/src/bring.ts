import { gitReason, nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { mergeBranch, type MergeOutcome } from './merge.js'
import { copiedFrom } from './session-folder.js'
import { currentBranch } from './worktree.js'

/**
 * A session's copy of a repo with no remote has nothing to push to and no pull request to open:
 * its work goes back to the folder it was copied from, on this machine. The copy's branch is
 * fetched into that folder as a branch of the same name; nothing else there changes, not the
 * branch the folder is on and not its files. Asked to, it is then merged into the folder's
 * default branch, by the rule a project's own merge has ({@link mergeBranch}), and the copy's
 * default branch takes the folder's, as a fetch from a remote would: the copy reads its work as
 * merged.
 *
 * The folder's branch of that name only ever moves forward: commits made on it there are the
 * person's, and a branch the folder has checked out is left to the person.
 */

/** Why a copy's branch was not brought. */
export type BringRefusal =
  /** The repository is no session's copy: it names no folder it came from. */
  | 'not-a-copy'
  /** The copy has no such branch. */
  | 'no-branch'
  /** The folder is on that branch. */
  | 'checked-out'
  /** The folder's branch of that name has commits the copy's does not. */
  | 'diverged'
  /** Git refused the fetch for another reason. */
  | 'fetch-failed'

export type BringOutcome =
  /** `merged` is there when the branch was merged into the folder's default branch too. */
  | { ok: true; branch: string; folder: string; merged?: Extract<MergeOutcome, { ok: true }> }
  | { ok: false; reason: 'not-a-copy' | 'no-branch'; branch: string }
  | { ok: false; reason: 'checked-out' | 'diverged'; branch: string; folder: string }
  | { ok: false; reason: 'fetch-failed'; branch: string; folder: string; detail: string }
  /** The branch is in the folder, and the merge there refused: nothing else changed. */
  | (Extract<MergeOutcome, { ok: false }> & { folder: string })

const tipOf = (repo: string, branch: string, git: GitRunner): Promise<string> => git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`], repo).then(out => out.trim(), () => '')

/** Bring the copy's `branch` into the folder it was copied from, and merge it there into the default branch when `merge` is set. */
export async function bringBranch(copy: string, branch: string, opts: { merge?: boolean } = {}, git: GitRunner = nodeGitRunner()): Promise<BringOutcome> {
  const folder = await copiedFrom(copy, git)
  if (folder === undefined) return { ok: false, reason: 'not-a-copy', branch }
  const tip = await tipOf(copy, branch, git)
  if (!tip) return { ok: false, reason: 'no-branch', branch }
  if ((await currentBranch(folder, git)) === branch) return { ok: false, reason: 'checked-out', branch, folder }
  const there = await tipOf(folder, branch, git)
  if (there && there !== tip) {
    const behind = await git(['merge-base', '--is-ancestor', there, tip], copy).then(() => true, () => false)
    if (!behind) return { ok: false, reason: 'diverged', branch, folder }
  }
  try {
    await git(['fetch', '--quiet', '--no-tags', copy, `refs/heads/${branch}:refs/heads/${branch}`], folder)
  } catch (err) {
    return { ok: false, reason: 'fetch-failed', branch, folder, detail: gitReason(err) }
  }
  if (!opts.merge) return { ok: true, branch, folder }
  const merged = await mergeBranch(folder, branch, git)
  if (!merged.ok) return { ...merged, folder }
  // The copy is on its own branch, so its default branch can move; a copy that cannot still has its work, merged or not.
  await git(['fetch', '--quiet', '--no-tags', folder, `+refs/heads/${merged.into}:refs/heads/${merged.into}`], copy).catch(() => {})
  return { ok: true, branch, folder, merged }
}

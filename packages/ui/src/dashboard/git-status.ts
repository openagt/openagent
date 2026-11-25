import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'

// The project panel's git status (#491, part of #488): the active branch, and whether the tree is
// dirty, a local git read. A run's pull request is its git host module's to read.

/** A project's git status for the panel. */
export interface GitStatus {
  branch: string
  /** Uncommitted changes present. */
  dirty: boolean
}

/** Injectable seams so {@link readGitStatus} is unit-testable off disk. */
export interface GitStatusDeps {
  git?: GitRunner
}

/**
 * The branch `cwd` has checked out, by its short name; `HEAD` when it is on no branch. Undefined
 * when `cwd` is not a git repo, or git failed.
 */
export async function currentBranch(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).then(out => out.trim(), () => undefined)
}

/**
 * Read a project's git status: the current branch and dirty flag. Returns undefined when the path
 * is not a git repo. Forgiving: a failed `git status` reads as clean.
 */
export async function readGitStatus(cwd: string, deps: GitStatusDeps = {}): Promise<GitStatus | undefined> {
  const git = deps.git ?? nodeGitRunner()
  const branch = await currentBranch(cwd, git)
  if (branch === undefined) return undefined // not a git repo (or git failed)
  const dirty = (await git(['status', '--porcelain'], cwd).catch(() => '')).trim().length > 0
  return { branch, dirty }
}

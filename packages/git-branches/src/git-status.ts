import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'

// A checkout's git status (#491, part of #488): the branch it is on, and whether its tree holds
// uncommitted changes, a local git read. What the project's row above a working run's message box
// says of the run's checkout.

/** A checkout's git status. */
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
 * Read a checkout's git status: the branch it is on by its short name (`HEAD` when it is on none)
 * and its dirty flag. Undefined when the path is not a git repo, or git failed. Forgiving: a failed
 * `git status` reads as clean.
 */
export async function readGitStatus(cwd: string, deps: GitStatusDeps = {}): Promise<GitStatus | undefined> {
  const git = deps.git ?? nodeGitRunner()
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).then(out => out.trim(), () => undefined)
  if (branch === undefined) return undefined // not a git repo (or git failed)
  const dirty = (await git(['status', '--porcelain'], cwd).catch(() => '')).trim().length > 0
  return { branch, dirty }
}

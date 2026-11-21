import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'

// The files git lists for the Files pane's tree: a checkout's, as they are on disk, or a commit's.

/** One NUL-separated list of paths from git, each exactly as git names it; none when git refuses. */
async function paths(git: GitRunner, cwd: string, args: string[]): Promise<string[]> {
  const out = await git(args, cwd).catch(() => '')
  return out.split('\0').filter(Boolean)
}

/**
 * Every file git sees in the checkout at `cwd` that is there on disk, tracked and untracked,
 * honoring .gitignore: repo-relative, each once, sorted. `[]` when `cwd` is not a repository.
 */
export async function listFiles(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string[]> {
  const [seen, deleted] = await Promise.all([paths(git, cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']), paths(git, cwd, ['ls-files', '-z', '--deleted'])])
  const files = new Set(seen)
  for (const path of deleted) files.delete(path)
  return [...files].sort()
}

/** Every file in the tree of the commit `ref` names, in the repository at `cwd`. */
export function listCommitFiles(cwd: string, ref: string, git: GitRunner = nodeGitRunner()): Promise<string[]> {
  return paths(git, cwd, ['ls-tree', '-r', '--name-only', '-z', ref])
}

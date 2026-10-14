import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'

/** One NUL-separated list of paths from git; none when git refuses. */
async function paths(git: GitRunner, cwd: string, args: string[]): Promise<string[]> {
  const out = await git(['ls-files', '-z', ...args], cwd).catch(() => '')
  return out.split('\0').map(entry => entry.trim()).filter(Boolean)
}

/**
 * Every file git sees in the checkout at `cwd` that is there on disk, tracked and untracked,
 * honoring .gitignore: repo-relative, each once, sorted. `[]` when `cwd` is not a repository.
 */
export async function listFiles(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string[]> {
  const [seen, deleted] = await Promise.all([paths(git, cwd, ['--cached', '--others', '--exclude-standard']), paths(git, cwd, ['--deleted'])])
  const files = new Set(seen)
  for (const path of deleted) files.delete(path)
  return [...files].sort()
}

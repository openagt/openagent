import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
// Per-file git status for the Changes pane (#492): the working-tree state of each changed file,
// untracked, modified or deleted. A single `git status --porcelain` read, mapped to repo-relative
// path -> state. Forgiving: a non-repo / failed git yields `{}`.

/**
 * One changed file's git state. `added` is a file a commit created (a run's committed change,
 * `run.ts`); the working tree's status here never says it, a new file there is `untracked`.
 */
export type FileGitStatus = 'untracked' | 'added' | 'modified' | 'deleted'

/** Strip git's surrounding quotes from a path with special chars (basic; leaves escapes as-is). */
function unquotePath(path: string): string {
  return path.length >= 2 && path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path
}

/**
 * Read each changed file's status from `git status --porcelain`, keyed by repo-relative path.
 * `??` is untracked, a `D` in either column is deleted, anything else (M/A/R/C…) reads as
 * modified. Renames map to the new path. Returns `{}` when the path is not a git repo.
 */
export async function readFileStatuses(cwd: string, git: GitRunner = nodeGitRunner()): Promise<Record<string, FileGitStatus>> {
  // Every new file by itself: without it git names a new folder once (`?? newdir/`), which is no file.
  // And names as they are: quoted, `café` would read `caf\303\251`, which the line counts do not use.
  const out = await git(['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all'], cwd).catch(() => '')
  const map: Record<string, FileGitStatus> = {}
  // Each line is two status columns, a space, then the path it is about.
  for (const line of out.split('\n')) {
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    let path = line.slice(3)
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4) // a rename: the new path is the one that exists
    path = unquotePath(path)
    if (path) map[path] = code === '??' ? 'untracked' : code.includes('D') ? 'deleted' : 'modified'
  }
  return map
}

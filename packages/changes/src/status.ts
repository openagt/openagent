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

/** One `git status --porcelain` line: the two status columns and the path they are about. */
export interface PorcelainEntry {
  code: string
  /** Repo-relative; a rename resolves to the new path. */
  path: string
}

/** Parse `git status --porcelain` output. Shared with the handoff's pending-files read (#1173). */
export function parsePorcelain(out: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = []
  for (const line of out.split('\n')) {
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    let path = line.slice(3)
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4) // a rename: the new path is the one that exists
    path = unquotePath(path)
    if (!path) continue
    entries.push({ code, path })
  }
  return entries
}

/**
 * Read each changed file's status from `git status --porcelain`, keyed by repo-relative path.
 * `??` is untracked, a `D` in either column is deleted, anything else (M/A/R/C…) reads as
 * modified. Renames map to the new path. Returns `{}` when the path is not a git repo.
 */
export async function readFileStatuses(cwd: string, git: GitRunner = nodeGitRunner()): Promise<Record<string, FileGitStatus>> {
  const out = await git(['status', '--porcelain'], cwd).catch(() => '')
  const map: Record<string, FileGitStatus> = {}
  for (const { code, path } of parsePorcelain(out)) {
    map[path] = code === '??' ? 'untracked' : code.includes('D') ? 'deleted' : 'modified'
  }
  return map
}

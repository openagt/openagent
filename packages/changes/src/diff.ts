import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import type { FileGitStatus } from './status.js'
import { cutToPreview, readConfinedFile, safeRepoPath } from './confined.js'

// One changed file's diff for the Changes pane (#816, #817). The list already says a file is new,
// modified or deleted; this says what actually changed, without leaving the dashboard for
// `git diff`. Read against whatever checkout the caller resolved, so a run's diff shows its
// worktree and not the project root (#815).
//
// The read takes a caller-supplied path, so the guard is here rather than at the call site:
// `safeRepoPath` is the only way in, and every caller goes through it.

/** The unchanged lines a diff shows around each change, as git does. */
export const CONTEXT_LINES = 3
/** Enough unchanged lines around a change to show the whole file: what "Show more lines" asks for. */
export const WHOLE_FILE = 100_000

/** One file's diff, capped so the pane can render it. */
export interface FileDiff {
  /** The repo-relative path asked for. */
  path: string
  status: FileGitStatus
  /** Unified diff body, hunks only (git's `diff --git` / index preamble is dropped). */
  patch: string
  added: number
  removed: number
  /** The patch hit the preview cap and was cut. */
  truncated: boolean
  /** Nothing textual to show (git reports a binary change, or the file is not UTF-8 text). */
  binary: boolean
  /** How many lines the file has now, so the pane knows whether lines are left under its last change; absent for a deleted file. */
  lines?: number
}

/** How many lines a text has, a last line with no newline counted. */
const linesIn = (text: string) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0))

/** One changed file in a session's Changes list (#817): what moved, and by how much. */
export interface FileChange {
  path: string
  status: FileGitStatus
  added: number
  removed: number
  /** Line counts are unavailable (a binary file, or an untracked one too large to count). */
  binary: boolean
}

/** Drop git's `diff --git` / `index` / `mode` preamble, keeping the `---`/`+++`/hunk body. */
function hunksOnly(patch: string): string {
  const lines = patch.split('\n')
  const start = lines.findIndex(line => line.startsWith('--- ') || line.startsWith('@@'))
  // Only the newline git ends with: a blank unchanged line is a single space, and it is a line.
  return (start === -1 ? [] : lines.slice(start)).join('\n').replace(/\n+$/, '')
}

/** Count the +/- lines of a unified patch, ignoring the `---`/`+++` file headers. */
function countChanges(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  let inHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    // The file headers only ever precede the first hunk. Past it a line opening the same way is
    // content — a removed `---` separator reads `----`, a removed `-- comment` reads `--- comment`
    // — and skipping those undercounted the file's own stats.
    if (!inHunk && (line.startsWith('+++') || line.startsWith('---'))) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}

/** An untracked file has no blob to diff against, so render its contents as all-added. */
function asAllAdded(text: string): string {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop() // a trailing newline is not a line
  return lines.map(line => `+${line}`).join('\n')
}

/**
 * The diff for one changed file in the checkout at `cwd`, or, given a `range`, between two
 * commits of the repository at `cwd` (a run's committed change, `run.ts`).
 *
 * Tracked files diff against `HEAD`, not the index, so a change the agent staged still shows;
 * that also matches `git status --porcelain`, which is what dotted the file in the first place.
 * An untracked file is rendered as all-added from its contents, since `git diff --no-index`
 * exits non-zero on a difference and would read as a failure here.
 *
 * Returns null when the path is unsafe, unreadable, or has no diff to show.
 */
export async function readFileDiff(
  cwd: string,
  path: string,
  status: FileGitStatus,
  git: GitRunner = nodeGitRunner(),
  range?: { from: string; to: string },
  context: number = CONTEXT_LINES,
): Promise<FileDiff | null> {
  if (!safeRepoPath(path)) return null

  if (!range && status === 'untracked') {
    const raw = await readConfinedFile(cwd, path)
    if (!raw) return null
    if (raw.includes(0)) return { path, status, patch: '', added: 0, removed: 0, truncated: false, binary: true }
    const all = asAllAdded(raw.toString('utf8'))
    const { body: patch, truncated } = cutToPreview(all)
    // Every line of an untracked file is an addition, so it is counted rather than parsed — and
    // counted over the whole file, not the cut preview: the Changes list reports the file's own
    // size, which a long new file used to report as exactly the preview limit.
    return { path, status, patch, added: all ? all.split('\n').length : 0, removed: 0, truncated, binary: false }
  }

  // `HEAD` is missing in a repo with no commits yet; the working-tree diff is the honest answer
  // there rather than an error.
  const raw = range
    ? await git(['diff', `--unified=${context}`, range.from, range.to, '--', path], cwd).catch(() => '')
    : await git(['diff', `--unified=${context}`, 'HEAD', '--', path], cwd)
        .catch(() => git(['diff', `--unified=${context}`, '--', path], cwd))
        .catch(() => '')
  if (!raw.trim()) return null
  if (/^Binary files /m.test(raw)) return { path, status, patch: '', added: 0, removed: 0, truncated: false, binary: true }

  const { body: patch, truncated } = cutToPreview(hunksOnly(raw))
  if (!patch) return null
  // The file as it is now: the range's last commit's copy, or the one on disk.
  const now = status === 'deleted' ? undefined : range ? await git(['show', `${range.to}:${path}`], cwd).catch(() => undefined) : (await readConfinedFile(cwd, path))?.toString('utf8')
  return { path, status, patch, ...countChanges(patch), truncated, binary: false, ...(now !== undefined ? { lines: linesIn(now) } : {}) }
}


/** One `git diff --numstat` line, parsed. */
export interface NumstatEntry {
  path: string
  added: number
  removed: number
  binary: boolean
}

/**
 * Parse `git diff --numstat` output: `added<TAB>removed<TAB>path`, with `-` for both counts
 * on a binary file. The one parser for the grammar — it was written here and in run-handoff,
 * and the copies had already drifted on a path containing a tab (this side rejoined it, the
 * other dropped the line).
 */
export function parseNumstat(out: string): NumstatEntry[] {
  const entries: NumstatEntry[] = []
  for (const line of out.split('\n')) {
    const [added, removed, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path || added === undefined || removed === undefined) continue
    const binary = added === '-' || removed === '-'
    entries.push({ path, added: binary ? 0 : Number(added) || 0, removed: binary ? 0 : Number(removed) || 0, binary })
  }
  return entries
}

/**
 * Every changed file in the checkout at `cwd`, with its line counts: the session's Changes list
 * (#817). One `git status` plus one `git diff --numstat`, not a diff per file, so a session that
 * touched forty files still costs two git calls.
 *
 * Untracked files have no numstat entry (they are not in the diff at all), so their added count
 * is their line count, read from disk. Sorted by path, so the list does not reshuffle as a live
 * session edits.
 */
export async function readFileChanges(
  cwd: string,
  statuses: Record<string, FileGitStatus>,
  git: GitRunner = nodeGitRunner(),
): Promise<FileChange[]> {
  const paths = Object.keys(statuses).filter(safeRepoPath)
  if (paths.length === 0) return []

  const numstat = await git(['-c', 'core.quotePath=false', 'diff', '--numstat', '--no-renames', 'HEAD'], cwd)
    .catch(() => git(['-c', 'core.quotePath=false', 'diff', '--numstat', '--no-renames'], cwd))
    .catch(() => '')
  const counted = new Map(parseNumstat(numstat).map(entry => [entry.path, entry]))

  const changes = await Promise.all(
    paths.map(async (path): Promise<FileChange> => {
      const status = statuses[path]!
      const known = counted.get(path)
      if (known) return { ...known, status }
      if (status !== 'untracked') return { path, status, added: 0, removed: 0, binary: false }
      // An untracked file is not in any diff, so its whole content is the addition.
      const diff = await readFileDiff(cwd, path, status, git).catch(() => null)
      return { path, status, added: diff?.added ?? 0, removed: 0, binary: diff?.binary ?? false }
    }),
  )
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

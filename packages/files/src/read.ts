// Reading one file out of a checkout, for the Files pane (#828). The path comes from the
// browser, so the guard and the confined read live here, once, and every caller goes through them.

/** Cap what the pane renders of one file. */
export const MAX_PREVIEW_LINES = 5000

/** One file's contents for the Files pane (#828). */
export interface FileContent {
  /** The repo-relative path asked for. */
  path: string
  /** The file's text, cut at {@link MAX_PREVIEW_LINES}. Empty when binary. */
  text: string
  /** The file was longer than the cap and was cut. */
  truncated: boolean
  /** Not UTF-8 text, so there is nothing to render. */
  binary: boolean
}

/**
 * Whether a client-supplied path may be read: repo-relative, no traversal, no absolute path, no
 * leading `-` (git would read it as a flag), and never into `.git` (config and credentials live
 * there). Rejecting is the whole contract; the caller resolves it against a checkout it chose.
 */
export function safeRepoPath(path: string): boolean {
  if (!path || path.length > 1024 || path.includes('\0')) return false
  if (path.startsWith('/') || path.startsWith('-') || /^[a-zA-Z]:/.test(path)) return false
  const parts = path.split(/[\\/]/)
  // Any `.git` segment, not just a leading one: a nested repo's `.git/config` holds credentials too.
  // Compared case-insensitively, because macOS and Windows are: there `.GIT/config` opens the very
  // file this refuses, and the path comes from the browser.
  if (parts.some(part => part.toLowerCase() === '.git')) return false
  return parts.every(part => part !== '' && part !== '.' && part !== '..')
}

/**
 * Read a repo-relative file from `cwd`, or null when it is unsafe, outside the checkout, or
 * unreadable.
 *
 * The confinement check is a `realpath` on both sides, not a string compare on the resolved path.
 * `resolve` does not follow symlinks, so `src/link.txt -> /etc/passwd` resolves to a path that sits
 * happily under `cwd` and passes a textual check while the read leaves the repo. `realpath` is what
 * makes the containment real; it also normalizes the platform's own links (macOS `/tmp`), which is
 * why `cwd` goes through it too rather than being compared raw.
 */
export async function readConfinedFile(cwd: string, path: string): Promise<Buffer | null> {
  if (!safeRepoPath(path)) return null
  const { readFile, realpath } = await import('node:fs/promises')
  const { resolve, sep } = await import('node:path')
  const root = await realpath(resolve(cwd)).catch(() => null)
  if (!root) return null
  // A missing file has no realpath, so this also answers "not there" before the read.
  const full = await realpath(resolve(cwd, path)).catch(() => null)
  if (!full || !full.startsWith(root + sep)) return null
  return readFile(full).catch(() => null)
}

/** Cut a body to {@link MAX_PREVIEW_LINES}, reporting whether anything was dropped. */
export function cutToPreview(body: string): { body: string; truncated: boolean } {
  const lines = body.split('\n')
  if (lines.length <= MAX_PREVIEW_LINES) return { body, truncated: false }
  return { body: lines.slice(0, MAX_PREVIEW_LINES).join('\n'), truncated: true }
}

/**
 * One file's contents (#828). Null when the path is unsafe, outside the checkout, or unreadable.
 * Read from the resolved checkout, so a session's pane shows its worktree's copy rather than the
 * project root's (#815).
 */
export async function readFileContent(cwd: string, path: string): Promise<FileContent | null> {
  const raw = await readConfinedFile(cwd, path)
  if (!raw) return null
  if (raw.includes(0)) return { path, text: '', truncated: false, binary: true }
  const { body, truncated } = cutToPreview(raw.toString('utf8').replace(/\n$/, ''))
  return { path, text: body, truncated, binary: false }
}

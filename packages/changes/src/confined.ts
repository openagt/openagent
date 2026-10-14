// Reading one file out of a checkout for a diff (diff.ts). The path comes from the browser, so the
// guard and the confined read live here, once, and every caller goes through them.

/** Cap what a diff renders: its first lines, and no more than its first characters. */
export const MAX_PREVIEW_LINES = 5000
export const MAX_PREVIEW_CHARS = 500_000

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

/** Cut a body to {@link MAX_PREVIEW_LINES} and {@link MAX_PREVIEW_CHARS}, reporting whether anything was dropped. */
export function cutToPreview(body: string): { body: string; truncated: boolean } {
  const short = body.length > MAX_PREVIEW_CHARS ? body.slice(0, MAX_PREVIEW_CHARS) : body
  const lines = short.split('\n')
  if (lines.length <= MAX_PREVIEW_LINES) return { body: short, truncated: short !== body }
  return { body: lines.slice(0, MAX_PREVIEW_LINES).join('\n'), truncated: true }
}

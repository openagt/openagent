import { lstat, readdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeGitRunner, type GitRunner } from './git.js'
import { unexcludeOnceGone } from './git-exclude.js'

/**
 * A tool's own directory at a project's root, taken away again: the files the tool names as its
 * own go one by one, then the directory once it is empty, then the rule that hid it from git.
 * What a tool's `cleanup` command runs when its files are a few named files in one directory.
 *
 * Nothing else goes. A file git tracks stays, and so does anything the tool did not name: a
 * person may have put it there. A link in the directory's place is followed nowhere, since what it
 * points at may lie outside the project. The rule is the repository's, read by every checkout of
 * it, so it goes only when this pass removed the directory and no other checkout holds one.
 */

/** One thing left where it was, by its path from the project's root, and why. */
export interface KeptEntry {
  path: string
  reason: string
}

/** What went and what stayed, each by its path from the project's root. */
export interface OwnDirectoryRemoval {
  removed: string[]
  kept: KeptEntry[]
}

export async function removeOwnDirectory(
  repo: string,
  dir: string,
  own: readonly string[],
  tool: string,
  git: GitRunner = nodeGitRunner(),
): Promise<OwnDirectoryRemoval> {
  const notOurs = `not made by ${tool}`
  const path = join(repo, dir)
  const kind = await kindOf(path)
  if (kind === 'none') return { removed: [], kept: [] }
  if (kind !== 'directory') return { removed: [], kept: [{ path: dir, reason: notOurs }] }

  const tracked = new Set((await git(['ls-files', '-z', '--', dir], repo)).split('\0').filter(Boolean))
  const gone: string[] = []
  const kept: KeptEntry[] = []
  for (const name of (await readdir(path)).sort()) {
    const entry = `${dir}/${name}`
    if (tracked.has(entry)) kept.push({ path: entry, reason: 'git tracks it' })
    else if (own.includes(name) && (await kindOf(join(path, name))) === 'file') {
      await rm(join(path, name), { force: true })
      gone.push(entry)
    } else kept.push({ path: entry, reason: notOurs })
  }
  // What stays keeps the directory, and the rule that hides it: the files that went are named instead.
  if (kept.length > 0) return { removed: gone, kept }
  // rmdir, never a recursive remove: whatever arrived meanwhile keeps the directory.
  if (!(await rmdir(path).then(() => true, () => false))) return { removed: gone, kept: [{ path: dir, reason: 'not empty' }] }
  await unexcludeOnceGone(repo, dir, git)
  return { removed: [dir], kept }
}

/** What sits at `path`, a link read as a link and never followed. */
async function kindOf(path: string): Promise<'none' | 'directory' | 'file' | 'other'> {
  const entry = await lstat(path).catch(() => undefined)
  if (!entry) return 'none'
  return entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
}

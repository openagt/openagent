import { posix } from 'node:path'
import { originDefaultBranch, type GitRunner } from '@openagt/agent-data'
import { START_POINT_FETCH_MS } from './names.js'

/**
 * Where a scheduled run's checkout starts, and whether a command's skill is there. A run works in
 * a fresh checkout made from origin's default branch, fetched first, or from HEAD in a repository
 * with no remote: never from the files a person has in their own checkout. So a skill a person
 * wrote and has not yet committed, or, with a remote, not yet brought onto its default branch, is
 * no command there: an agent started for it would be told a command it does not know. The tick
 * asks here once everything else says start, and starts nothing for a skill that is not there.
 */

/** The commit a run's checkout starts from, as the tick reads it. */
export interface StartPoint {
  /** What a checkout starts from, as git names it: `origin/main`, or `HEAD` with no remote. */
  ref: string
  /** Whether origin answered the fetch in time; true with no remote, where there is nothing to fetch. Not reached, the commit is the copy this clone last saw. */
  reached: boolean
}

/**
 * The start point, brought up to date the way a run's checkout is: origin's default branch is
 * fetched, waited for {@link START_POINT_FETCH_MS} at most. A fetch that fails (offline) or runs
 * longer leaves the copy this clone has, and the start point says origin was not reached.
 */
export async function readStartPoint(repo: string, git: GitRunner): Promise<StartPoint> {
  const origin = await originDefaultBranch(repo, git).catch(() => undefined)
  if (origin === undefined) return { ref: 'HEAD', reached: true }
  const fetched = git(['fetch', '--quiet', '--no-write-fetch-head', 'origin', origin.slice('origin/'.length)], repo).then(
    () => true,
    () => false,
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), START_POINT_FETCH_MS)
    timer.unref()
  })
  const reached = await Promise.race([fetched, capped])
  clearTimeout(timer)
  return { ref: origin, reached }
}

/**
 * One tick's question, "is this file where a run's checkout starts": the start point is read, and
 * so fetched, the first time it is asked and once only, however many commands are about to start.
 * A commit that cannot be read says nothing: the file counts as there, the command is not held
 * back, and its run says what is wrong.
 */
export function atStartOf(repo: string, git: GitRunner): (file: string) => Promise<StartPoint & { there: boolean }> {
  let start: Promise<StartPoint> | undefined
  return async file => {
    const point = await (start ??= readStartPoint(repo, git))
    return { ...point, there: (await isOnCommit(repo, point.ref, file, git)) ?? true }
  }
}

/** How many links one path may go through before it counts as not there: a link that points at itself ends here. */
const MAX_LINKS = 8

/**
 * Whether a file is on a commit, as a checkout of that commit would have it: a link on the way,
 * to a folder or to the file, is followed like the file system follows it (this repository keeps
 * each skill in one folder and links it from the other; a project may link the whole skills
 * folder). A link that leaves the repository, or whose target is not on the commit, leads nowhere.
 * `undefined` when the commit itself cannot be read: nothing can be said, and nothing is held back.
 */
export async function isOnCommit(repo: string, ref: string, file: string, git: GitRunner): Promise<boolean | undefined> {
  if ((await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo).catch(() => undefined)) === undefined) return undefined
  let path = file
  for (let links = 0; links <= MAX_LINKS; links++) {
    const next = await followOne(repo, ref, path, git)
    if (typeof next === 'boolean') return next
    path = next
  }
  return false
}

/** Walk one path down the commit's tree: true for a file there, false for nothing there, or the path to go on with when a link was met. */
async function followOne(repo: string, ref: string, path: string, git: GitRunner): Promise<boolean | string> {
  const parts = path.split('/')
  for (let i = 0; i < parts.length; i++) {
    const at = parts.slice(0, i + 1).join('/')
    const entry = await treeEntry(repo, ref, at, git)
    if (!entry) return false
    const last = i === parts.length - 1
    if (entry.mode === '120000') {
      const target = (await git(['cat-file', 'blob', entry.object], repo).catch(() => undefined))?.trim()
      if (target === undefined || target === '' || posix.isAbsolute(target)) return false
      const resolved = posix.normalize(posix.join(posix.dirname(at), target, ...parts.slice(i + 1)))
      return resolved === '..' || resolved.startsWith('../') ? false : resolved
    }
    if (last) return entry.type === 'blob'
    // A submodule or a file where a folder should be: a checkout has nothing below it.
    if (entry.type !== 'tree') return false
  }
  return false
}

/** One entry of the commit's tree, by its exact path; nothing when there is none. */
async function treeEntry(repo: string, ref: string, path: string, git: GitRunner): Promise<{ mode: string; type: string; object: string } | undefined> {
  // `:(literal)`: the path as written, never a pattern.
  const listed = await git(['ls-tree', ref, '--', `:(literal)${path}`], repo).catch(() => '')
  const read = /^(\d+) (\w+) ([0-9a-f]+)\t/.exec(listed)
  return read ? { mode: read[1]!, type: read[2]!, object: read[3]! } : undefined
}

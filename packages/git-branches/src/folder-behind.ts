import { nodeGitRunner, originDefaultBranch } from './git.js'
import type { GitRunner } from '@openagt/hooks'
import { currentBranch } from './worktree.js'

// A project's folder behind its remote (#2421). An agent's checkout starts from the remote's main
// branch, fetched first, but the folder itself is updated by nothing: after pull requests merge it
// stays where it was, and what the dashboard reads from it (the skills, the commands, the files)
// stays old with it. This says by how much, and brings the folder up on the person's press.

/** The folder's branch, and how many of the remote's commits it lacks. */
export interface FolderBehind {
  /** The main branch, by its short name (`main`). */
  branch: string
  behind: number
}

/** How long this clone's copy of the remote's main branch counts as fresh, per folder. */
const FRESH_MS = 60_000
/** How long a read waits for the fetch that freshens it; the fetch itself goes on. */
const FETCH_WAIT_MS = 5_000
const fetched = new Map<string, number>()

export interface FolderBehindDeps {
  /** Local git. */
  git?: GitRunner
  /** git for the talk with origin; none where origin is not asked, and the clone's copy is read as it is. */
  origin?: GitRunner | undefined
}

/** The remote's main branch as this clone has it (`origin/main`), when the folder is on that branch. */
async function mainOf(cwd: string, git: GitRunner): Promise<{ ref: string; branch: string } | undefined> {
  const ref = await originDefaultBranch(cwd, git)
  if (ref === undefined) return undefined
  const branch = ref.replace(/^origin\//, '')
  // On another branch the folder is the person's own work in progress: it is not behind, it is elsewhere.
  return (await currentBranch(cwd, git)) === branch ? { ref, branch } : undefined
}

/**
 * How far the project's folder is behind its remote's main branch; nothing when it is not: up to
 * date, on another branch, or with no remote. The remote is fetched first, at most once a minute
 * per folder, so a pull request merged a moment ago counts.
 */
export async function readFolderBehind(cwd: string, deps: FolderBehindDeps = {}): Promise<FolderBehind | undefined> {
  const git = deps.git ?? nodeGitRunner()
  const main = await mainOf(cwd, git)
  if (!main) return undefined
  if (deps.origin && Date.now() - (fetched.get(cwd) ?? 0) > FRESH_MS) {
    fetched.set(cwd, Date.now())
    const fetch = deps.origin(['fetch', '--quiet', 'origin', `+refs/heads/${main.branch}:refs/remotes/${main.ref}`], cwd).catch(() => undefined)
    await Promise.race([fetch, new Promise(resolve => setTimeout(resolve, FETCH_WAIT_MS).unref())])
  }
  const behind = Number((await git(['rev-list', '--count', `HEAD..refs/remotes/${main.ref}`], cwd).catch(() => '0')).trim())
  return behind > 0 ? { branch: main.branch, behind } : undefined
}

/**
 * Bring the folder up to its remote's main branch, as this clone has it: a fast-forward only, so
 * nothing of the person's is lost. git refuses, and its words are the answer, where the folder has
 * commits of its own the remote lacks, or uncommitted changes to a file the update changes.
 */
export async function updateFolder(cwd: string, deps: FolderBehindDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const git = deps.git ?? nodeGitRunner()
  const main = await mainOf(cwd, git)
  if (!main) return { ok: false, error: 'The folder is not on its main branch.' }
  try {
    await git(['merge', '--ff-only', '--quiet', `refs/remotes/${main.ref}`], cwd)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

import { mkdir, rm, rmdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { checkoutRoot, nodeGitRunner, originDefaultBranch, originUrl, sessionFolder, type GitRunner } from '@openagt/agent-data'
import { agentBranchName } from './branch-names.js'

/**
 * A repo a session has as context, beside the project it is in or with none: the folder it was
 * copied from, and the name of its copy in the session's folder.
 */
export interface SessionRepo {
  name: string
  from: string
}

/**
 * The repos given to a session, each by a folder in it: the repo's own top folder, named by that
 * folder's name, a name two of them share told apart by a number (`app`, `app-2`). The same
 * folders in the same order answer the same repos, so a run's own process names them as the start
 * did. Rejects a folder that is no git repository, saying which; a repo given twice counts once.
 */
export async function sessionRepos(folders: readonly string[], git: GitRunner = nodeGitRunner()): Promise<SessionRepo[]> {
  const repos: SessionRepo[] = []
  for (const folder of folders) {
    const from = await checkoutRoot(folder, git).catch(() => {
      throw new Error(`${folder} is not a git repository`)
    })
    if (repos.some(repo => repo.from === from)) continue
    const name = basename(from)
    let shown = name
    for (let n = 2; repos.some(repo => repo.name === shown); n++) shown = `${name}-${n}`
    repos.push({ name: shown, from })
  }
  return repos
}

/** How long a new copy waits for its origin: a host that does not answer must not hold the run's start. */
const ORIGIN_FETCH_MS = 20_000

/**
 * Origin's default branch as origin has it now, for a copy just cloned from a folder: its
 * branches are read from origin, which replaces what the clone took for them (the folder's own
 * branches), and its default branch is asked of origin too, where the clone had the branch the
 * folder was on. Nothing when origin does not answer in time or has no default branch to name.
 */
async function originStart(copy: string, git: GitRunner): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = new Promise<false>(resolve => {
    timer = setTimeout(() => resolve(false), ORIGIN_FETCH_MS)
    timer.unref()
  })
  const fetched = await Promise.race([git(['fetch', '--quiet', '--prune', 'origin'], copy).then(() => true, () => false), capped])
  clearTimeout(timer)
  if (!fetched) return undefined
  // The clone's `origin/HEAD` names the branch the folder was on: origin says its own, or it names none.
  await git(['remote', 'set-head', 'origin', '--auto'], copy).catch(() => git(['remote', 'set-head', 'origin', '--delete'], copy).catch(() => {}))
  return originDefaultBranch(copy, git)
}

/** The copy's own git setting that names the commit it was made at. */
const START_KEY = 'openagent.start'

/** The copy's own git setting that names the folder it was copied from. */
const FROM_KEY = 'openagent.from'

/** The commit a session's copy of a repo was made at, as the copy names it: what it holds beyond it is the session's work. Nothing for any other repository. */
export async function copyStart(repo: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  return (await git(['config', '--get', START_KEY], repo).catch(() => '')).trim() || undefined
}

/**
 * The folder a session's copy of a repo was copied from, as the copy names it: where the work of a
 * copy with no remote goes back to (`bring.ts`). Nothing for any other repository.
 */
export async function copiedFrom(repo: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  return (await git(['config', '--get', FROM_KEY], repo).catch(() => '')).trim() || undefined
}

/** Why a run with no project keeps where it worked, whatever its end: see {@link openSessionFolder}. */
export const SESSION_FOLDER_STAYS = 'a session folder stays'

/**
 * A session's own folder in the sessions home, made when it is not there yet: where a run with no
 * project works, and where a run in a project keeps the copies of the repos it has as context,
 * its own work being in its checkout of the project. The folder itself has no branch and no git:
 * it stays when the run ends, holding what the agent made, and a resumed run goes on in it.
 *
 * Each repo the session has is a copy in it, under its name: a clone of the repo's folder, on a new
 * branch `agent-<id>`, its `origin` the repo's own (none when the repo has none, so nothing goes
 * back into the folder it came from). The branch starts from origin's default branch as origin has
 * it now, as a project's run does: what the folder is on, and commits it holds that were never
 * pushed, are the person's, and a pull request of the copy carries the session's work alone. A
 * repo with no origin, or one whose origin does not answer, starts from the folder as it is
 * committed. A clone and not a worktree: the repo is not
 * the session's project, and the session leaves nothing in it; deleting the session's folder takes
 * it all. A copy already there is kept as it is, with the agent's work; one that is gone is made
 * again. `made` names the copies this call made, for the agent to be told of.
 */
export async function openSessionFolder(home: string, id: string, repos: readonly SessionRepo[] = [], git: GitRunner = nodeGitRunner()): Promise<{ path: string; made: SessionRepo[] }> {
  const path = sessionFolder(home, id)
  await mkdir(path, { recursive: true })
  const made: SessionRepo[] = []
  for (const repo of repos) {
    const copy = join(path, repo.name)
    if (await stat(copy).then(() => true, () => false)) continue
    made.push(repo)
    await git(['clone', '--quiet', '--', repo.from, copy], path)
    const origin = await originUrl(repo.from, git)
    await git(origin ? ['remote', 'set-url', 'origin', origin] : ['remote', 'remove', 'origin'], copy)
    const start = origin ? await originStart(copy, git) : undefined
    await git(['checkout', '--quiet', '--no-track', '-b', agentBranchName(id), ...(start !== undefined ? [start] : [])], copy)
    // Where the copy starts, kept in the copy itself: what it holds beyond it is the session's work, pushed or not.
    await git(['config', START_KEY, (await git(['rev-parse', 'HEAD'], copy)).trim()], copy)
    await git(['config', FROM_KEY, repo.from], copy)
  }
  return { path, made }
}

/**
 * What a run in a project is told of the copies just made for it: where each is and where it came
 * from. A run with no project is told nothing: it starts in the folder that holds them.
 */
export function copiesLine(folder: string, id: string, made: readonly SessionRepo[]): string {
  const copies = made.map(repo => `${join(folder, repo.name)} (copied from ${repo.from})`).join(', ')
  return `Context: this session has its own ${made.length === 1 ? 'copy of a repo' : 'copies of repos'}, on the branch ${agentBranchName(id)}: ${copies}. Read and change ${made.length === 1 ? 'it' : 'them'} there, not in the folder${made.length === 1 ? '' : 's'} copied from.`
}

/**
 * A run in a project is over: the copies it never touched go, and its session folder with them
 * once it is empty. A copy is untouched when its tree is clean and no branch of it holds a commit
 * beyond the one it was made at, which the copy itself names. One with work stays, pushed or not:
 * a resumed run goes on in it, and its branch is where the session's work bar reads it. A copy that
 * went is made again by a resume ({@link openSessionFolder}). A copy that does not say where it
 * started stays. Answers the names that went.
 */
export async function dropUntouchedCopies(home: string, id: string, repos: readonly SessionRepo[], git: GitRunner = nodeGitRunner()): Promise<string[]> {
  const path = sessionFolder(home, id)
  const gone: string[] = []
  for (const repo of repos) {
    const copy = join(path, repo.name)
    if (!(await stat(join(copy, '.git')).then(() => true, () => false))) continue
    const start = await copyStart(copy, git)
    const untouched =
      start !== undefined &&
      (await Promise.all([git(['status', '--porcelain'], copy), git(['rev-list', '--max-count=1', '--branches', '--not', start], copy)]).then(([dirty, own]) => dirty.trim() === '' && own.trim() === '', () => false))
    if (!untouched) continue
    await rm(copy, { recursive: true, force: true })
    gone.push(repo.name)
  }
  // Only an empty folder goes: `rmdir` refuses one that still holds a copy.
  await rmdir(path).catch(() => {})
  return gone
}

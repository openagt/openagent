import { mkdir, readdir, realpath, rm, rmdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { checkoutRoot, nodeGitRunner, originDefaultBranch } from './git.js'
import { type GitRunner, isBranchName, originUrl } from '@openagt/hooks'
import { sessionFolder } from './sessions.js'
import { agentBranchName } from './branch-names.js'
import { isCopyName, nameRepos, type SessionRepo } from './repo-names.js'

export type { SessionRepo } from './repo-names.js'

/**
 * The repos given to a session, each by a folder in it: the repo's own top folder, named as
 * {@link nameRepos} names them, beside the repos the session has (`have`) and the other names its
 * folder holds (`taken`). Rejects a folder that is no git repository, saying which.
 *
 * A repo is named by its top folder as it was given, when the folder given is that top: on a disk
 * that ignores case, a project added as ~/projects/shop is ~/Projects/shop to git, and the dashboard,
 * which lists the project as it was added, tells the copy its own only by the same words. The same
 * repo, however its folder was spelt, counts once.
 */
export async function sessionRepos(folders: readonly string[], git: GitRunner = nodeGitRunner(), have: readonly SessionRepo[] = [], taken: readonly string[] = []): Promise<SessionRepo[]> {
  const real = (path: string): Promise<string> => realpath(path).catch(() => path)
  const seen = new Set(await Promise.all(have.map(repo => real(repo.from))))
  const tops: string[] = []
  for (const folder of folders) {
    const root = await checkoutRoot(folder, git).catch(() => {
      throw new Error(`${folder} is not a git repository`)
    })
    const given = resolve(folder)
    const top = await real(root)
    if (seen.has(top)) continue
    seen.add(top)
    tops.push((await real(given)) === top ? given : root)
  }
  return nameRepos(tops, have, taken)
}

/**
 * The repos a run's options name, as its steps may take them: each named by one folder's name,
 * no two alike, and copied from a repository's own top folder on this computer. Whoever wrote the
 * options named them; a name that would climb out of the session's folder, or a folder that is no
 * repository's top, refuses the run, saying which.
 */
export async function checkedRepos(repos: readonly SessionRepo[], git: GitRunner = nodeGitRunner()): Promise<SessionRepo[]> {
  for (const [i, repo] of repos.entries()) {
    if (!isCopyName(repo.name) || repos.findIndex(other => other.name === repo.name) !== i) throw new Error(`not a name for a copy of a repo: ${repo.name}`)
    // git names a repository's top by its real path: the folder is compared as it really is.
    const [top, real] = isAbsolute(repo.from) ? await Promise.all([checkoutRoot(repo.from, git).catch(() => undefined), realpath(repo.from).catch(() => undefined)]) : []
    if (top === undefined || top !== real) throw new Error(`${repo.from} is not a git repository`)
    if (repo.base !== undefined && !isBranchName(repo.base)) throw new Error(`not a branch name: ${repo.base}`)
  }
  return [...repos]
}

/** How long a new copy waits for its origin: a host that does not answer must not hold the run's start. */
const ORIGIN_FETCH_MS = 20_000

/**
 * Origin's default branch as origin has it now, for a copy just cloned from a folder: its
 * branches are read from origin, which replaces what the clone took for them (the folder's own
 * branches), and its default branch is asked of origin too, where the clone had the branch the
 * folder was on. Nothing when origin does not answer in time or has no default branch to name.
 */
async function originStart(copy: string, base: string | undefined, git: GitRunner): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = new Promise<false>(resolve => {
    timer = setTimeout(() => resolve(false), ORIGIN_FETCH_MS)
    timer.unref()
  })
  const fetched = await Promise.race([git(['fetch', '--quiet', '--prune', 'origin'], copy).then(() => true, () => false), capped])
  clearTimeout(timer)
  if (!fetched) {
    if (base !== undefined) throw new Error(`origin could not be reached for the branch ${base}`)
    return undefined
  }
  // A branch picked for the copy: origin's, as origin has it now.
  if (base !== undefined) {
    const there = (await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], copy).catch(() => '')).trim()
    if (!there) throw new Error(`origin has no branch ${base}`)
    return `origin/${base}`
  }
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
 * it now, as a project's run does, or from origin's branch the repo names (`base`): what the folder is on, and commits it holds that were never
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
    if (repo.base !== undefined && !origin) throw new Error(`${repo.name} has no origin to start from ${repo.base}`)
    const start = origin ? await originStart(copy, repo.base, git) : undefined
    await git(['checkout', '--quiet', '--no-track', '-b', agentBranchName(id), ...(start !== undefined ? [start] : [])], copy)
    // Where the copy starts, kept in the copy itself: what it holds beyond it is the session's work, pushed or not.
    await git(['config', START_KEY, (await git(['rev-parse', 'HEAD'], copy)).trim()], copy)
    await git(['config', FROM_KEY, repo.from], copy)
  }
  return { path, made }
}

/**
 * Repos given to a session that is already going, by a tick with a message, a resume, or its
 * agent's own `add` command: each made a copy in its folder as at its start
 * ({@link openSessionFolder}), named beside `have`, the repos it has, and beside whatever else its
 * folder holds. Answers the repos it has now and the copies this call made. A repo it has already
 * adds nothing.
 */
export async function addSessionRepos(
  home: string,
  id: string,
  have: readonly SessionRepo[],
  folders: readonly string[],
  git: GitRunner = nodeGitRunner(),
): Promise<{ repos: SessionRepo[]; made: SessionRepo[]; path: string }> {
  const fresh = await moreRepos(home, id, have, folders, git)
  const { path, made } = await openSessionFolder(home, id, fresh, git)
  return { repos: [...have, ...fresh], made, path }
}

/**
 * The repos in `folders` a session that has `have` is given beside them, each named beside its
 * repos and beside whatever else its folder holds ({@link sessionRepos}): the new ones alone, not
 * copied yet. A resume names them so, and its run's start copies them ({@link openSessionFolder}).
 */
export async function moreRepos(home: string, id: string, have: readonly SessionRepo[], folders: readonly string[], git: GitRunner = nodeGitRunner()): Promise<SessionRepo[]> {
  const taken = (await readdir(sessionFolder(home, id)).catch(() => [] as string[])).filter(name => !have.some(repo => repo.name === name))
  return sessionRepos(folders, git, have, taken)
}

/**
 * The copies in a session's folder its repos do not name yet: each one made by `add` while its run
 * went on, which the copy itself says, naming the folder it was copied from. A repository the
 * agent cloned there on its own names none, and is no repo of the session's.
 */
export async function foundCopies(home: string, id: string, have: readonly SessionRepo[], git: GitRunner = nodeGitRunner()): Promise<SessionRepo[]> {
  const path = sessionFolder(home, id)
  const names = (await readdir(path).catch(() => [] as string[])).filter(name => isCopyName(name) && !have.some(repo => repo.name === name)).sort()
  const found = await Promise.all(
    names.map(async name => {
      const from = await copiedFrom(join(path, name), git)
      return from !== undefined ? { name, from } : undefined
    }),
  )
  return found.filter((repo): repo is SessionRepo => repo !== undefined)
}

/**
 * A run in a project is over: the copies it never touched go, every one its folder holds, the
 * ones added while it went on too, and its session folder with them once it is empty. A copy is untouched when its tree is clean and no branch of it holds a commit
 * beyond the one it was made at, which the copy itself names. One with work stays, pushed or not:
 * a resumed run goes on in it, and its branch is where the session's work bar reads it. A copy that
 * went is made again by a resume ({@link openSessionFolder}). A copy that does not say where it
 * started stays. Answers the names that went.
 */
export async function dropUntouchedCopies(home: string, id: string, git: GitRunner = nodeGitRunner()): Promise<string[]> {
  const path = sessionFolder(home, id)
  const gone: string[] = []
  for (const name of (await readdir(path).catch(() => [] as string[])).filter(isCopyName)) {
    const copy = join(path, name)
    if (!(await stat(join(copy, '.git')).then(() => true, () => false))) continue
    const start = await copyStart(copy, git)
    const untouched =
      start !== undefined &&
      (await Promise.all([git(['status', '--porcelain'], copy), git(['rev-list', '--max-count=1', '--branches', '--not', start], copy)]).then(([dirty, own]) => dirty.trim() === '' && own.trim() === '', () => false))
    if (!untouched) continue
    await rm(copy, { recursive: true, force: true })
    gone.push(name)
  }
  // Only an empty folder goes: `rmdir` refuses one that still holds a copy.
  await rmdir(path).catch(() => {})
  return gone
}

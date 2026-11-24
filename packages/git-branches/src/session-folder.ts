import { mkdir, rm, rmdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { checkoutRoot, nodeGitRunner, originUrl, sessionFolder, type GitRunner } from '@openagt/agent-data'
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

/** The copy's own git setting that names the commit it was made at. */
const START_KEY = 'openagent.start'

/** Why a run with no project keeps where it worked, whatever its end: see {@link openSessionFolder}. */
export const SESSION_FOLDER_STAYS = 'a session folder stays'

/**
 * A session's own folder in the sessions home, made when it is not there yet: where a run with no
 * project works, and where a run in a project keeps the copies of the repos it has as context,
 * its own work being in its checkout of the project. The folder itself has no branch and no git:
 * it stays when the run ends, holding what the agent made, and a resumed run goes on in it.
 *
 * Each repo the session has is a copy in it, under its name: a clone of the repo's folder as it is
 * committed, on a new branch `agent-<id>`, its `origin` the repo's own (none when the repo has none,
 * so nothing goes back into the folder it came from). A clone and not a worktree: the repo is not
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
    await git(['checkout', '--quiet', '-b', agentBranchName(id)], copy)
    // Where the copy starts, kept in the copy itself: what it holds beyond it is the session's work, pushed or not.
    await git(['config', START_KEY, (await git(['rev-parse', 'HEAD'], copy)).trim()], copy)
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
    const start = (await git(['config', '--get', START_KEY], copy).catch(() => '')).trim()
    const untouched =
      start !== '' &&
      (await Promise.all([git(['status', '--porcelain'], copy), git(['rev-list', '--max-count=1', '--branches', '--not', start], copy)]).then(([dirty, own]) => dirty.trim() === '' && own.trim() === '', () => false))
    if (!untouched) continue
    await rm(copy, { recursive: true, force: true })
    gone.push(repo.name)
  }
  // Only an empty folder goes: `rmdir` refuses one that still holds a copy.
  await rmdir(path).catch(() => {})
  return gone
}

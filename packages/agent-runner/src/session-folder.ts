import { mkdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { checkoutRoot, nodeGitRunner, originUrl, sessionFolder, type GitRunner } from '@openagt/agent-data'
import { agentBranchName, linkSkillsInFolder, type SkillLink } from '@openagt/skill-branches'
import type { SessionRepo } from './records.js'

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

/** Why a run with no project keeps where it worked, whatever its end: see {@link openSessionFolder}. */
export const SESSION_FOLDER_STAYS = 'a session folder stays'

/**
 * Where a run with no project works: a folder of its own in the sessions home, made when it is not
 * there yet, the run's skills linked in where its coding agent looks for them. The folder itself has
 * no branch and no git: it stays when the run ends, holding what the agent made, and a resumed run
 * goes on in it.
 *
 * Each repo the session has is a copy in it, under its name: a clone of the repo's folder as it is
 * committed, on a new branch `agent-<id>`, its `origin` the repo's own (none when the repo has none,
 * so nothing goes back into the folder it came from). A clone and not a worktree: the repo is no
 * project, and the session leaves nothing in it; deleting the session's folder takes it all. A copy
 * already there is kept as it is, with the agent's work; one that is gone is made again.
 */
export async function openSessionFolder(home: string, id: string, skills: readonly SkillLink[], repos: readonly SessionRepo[] = [], git: GitRunner = nodeGitRunner()): Promise<{ path: string }> {
  const path = sessionFolder(home, id)
  await mkdir(path, { recursive: true })
  await linkSkillsInFolder(path, skills)
  for (const repo of repos) {
    const copy = join(path, repo.name)
    if (await stat(copy).then(() => true, () => false)) continue
    await git(['clone', '--quiet', '--', repo.from, copy], path)
    const origin = await originUrl(repo.from, git)
    await git(origin ? ['remote', 'set-url', 'origin', origin] : ['remote', 'remove', 'origin'], copy)
    await git(['checkout', '--quiet', '-b', agentBranchName(id)], copy)
  }
  return { path }
}

import { basename } from 'node:path'
import { errorMessage, nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import type { GhRunner } from './gh.js'

/**
 * Creating the project's repository on GitHub: for a project that lives on one machine only, a
 * private repository under the logged-in account, named after the project's folder, set as the
 * project's `origin` and pushed to. One step for the person, through `gh`.
 *
 * Always private: making code public is a decision this never takes. Only for a project with no
 * `origin` yet: a project that has a remote is already somewhere, and is not moved.
 */

/** What can be created, said before anything is: the account's repository the project would become. */
export type CreateOffer =
  | { ok: true; repository: string }
  | { ok: false; reason: 'has-remote' }
  | { ok: false; reason: 'not-logged-in'; detail: string }

export type CreateOutcome =
  | { ok: true; repository: string; url: string }
  | { ok: false; reason: 'has-remote' }
  | { ok: false; reason: 'not-logged-in' | 'create-failed'; detail: string }

/** Whether the repository at `cwd` has an `origin` remote. */
async function hasOrigin(cwd: string, git: GitRunner): Promise<boolean> {
  return git(['remote'], cwd).then(out => out.split('\n').some(line => line.trim() === 'origin'), () => false)
}

/** The repository the project would become: `<the logged-in account>/<the project folder's name>`. */
export async function offerRepository(cwd: string, deps: { gh: GhRunner; git?: GitRunner }): Promise<CreateOffer> {
  const git = deps.git ?? nodeGitRunner()
  if (await hasOrigin(cwd, git)) return { ok: false, reason: 'has-remote' }
  let login: string
  try {
    login = (await deps.gh(['api', 'user', '--jq', '.login'], cwd)).trim()
  } catch (err) {
    return { ok: false, reason: 'not-logged-in', detail: errorMessage(err) }
  }
  if (!login) return { ok: false, reason: 'not-logged-in', detail: 'gh named no account' }
  return { ok: true, repository: `${login}/${basename(cwd)}` }
}

/** Create the private repository, set it as `origin`, and push the branch the project's folder is on. */
export async function createRepository(cwd: string, deps: { gh: GhRunner; git?: GitRunner }): Promise<CreateOutcome> {
  const offer = await offerRepository(cwd, deps)
  if (!offer.ok) return offer
  try {
    await deps.gh(['repo', 'create', offer.repository, '--private', '--source', '.', '--remote', 'origin', '--push'], cwd)
  } catch (err) {
    return { ok: false, reason: 'create-failed', detail: errorMessage(err) }
  }
  return { ok: true, repository: offer.repository, url: `https://github.com/${offer.repository}` }
}

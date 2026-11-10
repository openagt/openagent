import { HOST } from './accounts.js'
import { errorMessage } from '@openagt/agent-data'
import type { GhRunner } from './gh.js'

/**
 * The repositories of a GitHub user or organization, as an account of OpenAgent's sees them:
 * what the dashboard's project picker lists beside the repos on the computer, to be cloned when
 * picked. Asked of `gh` as that account, so a private one it can read is listed too.
 */

/** A repository as the picker lists it. */
export interface ListedRepo {
  /** `github.com/<owner>/<name>`: the repository's one name on every machine. */
  address: string
  url: string
  private: boolean
  pushedAt?: string
  description?: string
}

/** How many repositories one listing asks for. */
export const REPOS_LIMIT = 300

export async function listRepos(gh: GhRunner, cwd: string, owner: string): Promise<ListedRepo[]> {
  let said: unknown
  try {
    said = JSON.parse(await gh(['repo', 'list', owner, '--limit', String(REPOS_LIMIT), '--json', 'nameWithOwner,url,isPrivate,pushedAt,description'], cwd))
  } catch (err) {
    throw new Error(`GitHub did not list ${owner}'s repositories: ${errorMessage(err)}`)
  }
  const repos: ListedRepo[] = []
  for (const row of Array.isArray(said) ? said : []) {
    const { nameWithOwner, url, isPrivate, pushedAt, description } = (row ?? {}) as Record<string, unknown>
    if (typeof nameWithOwner !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(nameWithOwner) || typeof url !== 'string' || !url.startsWith('https://')) continue
    repos.push({
      address: `${HOST}/${nameWithOwner}`,
      url,
      private: isPrivate === true,
      ...(typeof pushedAt === 'string' ? { pushedAt } : {}),
      ...(typeof description === 'string' && description.trim() ? { description: description.trim() } : {}),
    })
  }
  return repos.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
}

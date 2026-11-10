import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { personalFolder, withPersonalFolder, type PersonalFolderDeps } from './personal-folder.js'
import type { FileBranchWrite } from './file-branch.js'

/**
 * The users and organizations at a git host whose repositories the person wants listed beside
 * the ones on their computer (Rom's design: "GitHub users/orgs, e.g. vikejs"), each as
 * `<host>/<name>`: `github.com/vikejs`. One file in the personal folder, `repo-owners.json`, so
 * every computer of theirs lists the same.
 */

export const REPO_OWNERS_FILE = 'repo-owners.json'

/** How many are kept: each is a listing asked of the host. */
const MAX_OWNERS = 30

/** `<host>/<name>`, as a host allows a user's or an organization's name. */
const OWNER = /^[a-z0-9.-]+\.[a-z]{2,}\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

export function isRepoOwner(value: unknown): value is string {
  return typeof value === 'string' && OWNER.test(value)
}

/** The owners as their file names them; none when there is no file. */
export async function readRepoOwners(folder: string = personalFolder()): Promise<string[]> {
  const text = await readFile(join(folder, REPO_OWNERS_FILE), 'utf8').catch(() => undefined)
  if (text === undefined) return []
  try {
    const { owners } = JSON.parse(text) as { owners?: unknown }
    return Array.isArray(owners) ? [...new Set(owners.filter(isRepoOwner))].slice(0, MAX_OWNERS) : []
  } catch {
    return []
  }
}

/** Write the owners, committed in the personal folder, so they go to every computer that syncs it. */
export async function writeRepoOwners(owners: readonly string[], deps: PersonalFolderDeps = {}): Promise<FileBranchWrite> {
  const folder = deps.folder ?? personalFolder()
  const kept = [...new Set(owners.filter(isRepoOwner))].slice(0, MAX_OWNERS)
  return withPersonalFolder(
    folder,
    'update the repo owners',
    async () => {
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, REPO_OWNERS_FILE), JSON.stringify({ owners: kept }, null, 2) + '\n')
    },
    deps,
  )
}

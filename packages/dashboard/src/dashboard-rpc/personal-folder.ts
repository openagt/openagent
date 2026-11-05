import { readPersonalFolder, readSharing, stopSyncingPersonalFolder, syncPersonalFolder } from '@openagt/agent-data'
import { contextProjects } from './context.js'
import { providedDataChanged } from '../store/provided.js'
import { repositoryUrlOf } from '../repository-url.js'
import { personalFolderShown, type PersonalFolderShown } from '../personal-folder-shown.js'

// Settings › Agent data: where everything the agents keep is. The person's own folder, `~/.openagent`,
// which may sync with a repository of theirs so every machine of theirs has the same data.

export interface PersonalFolderView extends PersonalFolderShown {
  /** Commits made here that have not reached the repository yet. */
  unsent: number
  /** The projects of this computer that keep their agent data in it, by name. */
  projects: string[]
}

export async function onPersonalFolder(): Promise<PersonalFolderView> {
  const [state, projects] = await Promise.all([readPersonalFolder(), contextProjects().list()])
  const kept: string[] = []
  for (const project of projects) if (!(await readSharing(project.path).catch(() => false))) kept.push(project.name)
  return { ...personalFolderShown(state), unsent: state.unsent, projects: kept }
}

/** Sync the personal folder with the person's repository: what it has comes in, every record here goes out. */
export async function sendSyncPersonalFolder(typed: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = typeof typed === 'string' ? repositoryUrlOf(typed) : undefined
  if (!url) return { ok: false, error: 'That is not a repository address. Paste one like github.com/you/agent.' }
  const synced = await syncPersonalFolder(url)
  // What came in from the repository is read again: another machine's runs and tickets.
  if (synced.ok) for (const project of await contextProjects().list()) providedDataChanged(project.path)
  return synced
}

/** Stop syncing: the repository is forgotten here, every record stays on this machine and on the repository. */
export async function sendStopSyncingPersonalFolder(): Promise<{ ok: true } | { ok: false; error: string }> {
  return stopSyncingPersonalFolder()
}

import { homedir } from 'node:os'
import { readPersonalFolder, readSharing, spellingOfRemote, stopSyncingPersonalFolder, syncPersonalFolder } from '@openagt/agent-data'
import { contextProjects } from './context.js'
import { providedDataChanged } from '../store/provided.js'
import { repositoryUrlOf } from '../repository-url.js'

// Settings › Folders: where the agents' records are kept. The person's own folder, `~/.openagent`,
// which may sync with a repository of theirs so every machine of theirs has the same records, and
// the projects shared on their own repository's branch instead.

export interface FoldersView {
  personal: {
    /** The folder, with the home directory as `~`. */
    path: string
    /** The repository it syncs with, as `host/path`, or its address as given when it is not one. */
    remote?: string
    /** Commits made here that have not reached the repository yet. */
    unsent: number
    /** The projects of this machine that keep their records in it, by name. */
    projects: string[]
  }
  /** The projects that keep their records on their own repository's branch, by name. */
  shared: string[]
}

export async function onFolders(): Promise<FoldersView> {
  const [state, projects] = await Promise.all([readPersonalFolder(), contextProjects().list()])
  const personal: string[] = []
  const shared: string[] = []
  for (const project of projects) ((await readSharing(project.path).catch(() => false)) ? shared : personal).push(project.name)
  const home = homedir()
  const path = state.path === home || state.path.startsWith(home + '/') ? '~' + state.path.slice(home.length) : state.path
  return {
    personal: { path, ...(state.remote ? { remote: spellingOfRemote(state.remote) ?? state.remote } : {}), unsent: state.unsent, projects: personal },
    shared,
  }
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

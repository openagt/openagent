import { readPersonalFolder, readSharing, remoteHostOf, sendPersonalFolderAs as sendFolderAs, stopSyncingPersonalFolder, syncPersonalFolder } from '@openagt/agent-data'
import { accountsByHost, remoteAccount, type SendAsHost } from './send-as.js'

export type { SendAsHost } from './send-as.js'
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
  /** The login of OpenAgent's account it is sent as, when it syncs. */
  account?: string
  /** OpenAgent's accounts at each host: what it may be sent as. */
  hosts: SendAsHost[]
}

export async function onPersonalFolder(): Promise<PersonalFolderView> {
  const [state, projects, hosts] = await Promise.all([readPersonalFolder(), contextProjects().list(), accountsByHost().catch((): SendAsHost[] => [])])
  const kept: string[] = []
  for (const project of projects) if (!(await readSharing(project.path).catch(() => false))) kept.push(project.name)
  return { ...personalFolderShown(state), unsent: state.unsent, projects: kept, ...(state.account ? { account: state.account } : {}), hosts }
}

/**
 * Sync the personal folder with the person's repository, sent as `login`, one of OpenAgent's
 * accounts at its host: what it has comes in, every record here goes out. Never as the person's
 * own login: with no account there, nothing is sent.
 */
export async function sendSyncPersonalFolder(typed: string, login?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = typeof typed === 'string' ? repositoryUrlOf(typed) : undefined
  if (!url) return { ok: false, error: 'That is not a repository address. Paste one like github.com/you/agent.' }
  const host = remoteHostOf(url)
  const account = host !== undefined ? await remoteAccount(host, login) : undefined
  if (account && !account.ok) return account
  const synced = await syncPersonalFolder(url, account?.account)
  // What came in from the repository is read again: another machine's runs and tickets.
  if (synced.ok) for (const project of await contextProjects().list()) providedDataChanged(project.path)
  return synced
}

/** Send the personal folder as another of OpenAgent's accounts from now on. */
export async function sendPersonalFolderAs(login: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const remote = (await readPersonalFolder()).remote
  const host = remote ? remoteHostOf(remote) : undefined
  if (host === undefined) return { ok: false, error: 'Your folder syncs with no repository on a git host.' }
  const account = await remoteAccount(host, login)
  return account.ok ? sendFolderAs(account.account) : account
}

/** Stop syncing: the repository is forgotten here, every record stays on this machine and on the repository. */
export async function sendStopSyncingPersonalFolder(): Promise<{ ok: true } | { ok: false; error: string }> {
  return stopSyncingPersonalFolder()
}

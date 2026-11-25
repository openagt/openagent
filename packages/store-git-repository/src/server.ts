import { readPersonalFolder, sendPersonalFolderAs, stopSyncingPersonalFolder, syncPersonalFolder } from './folder-sync.js'
import { readSharing } from '@openagt/store-filesystem'
import { remoteHostOf, type HostAccounts } from '@openagt/hooks'
import { act, read, type RpcComputerHost } from '@openagt/hooks/rpc'
import { backUpProjectAs, personalGap, projectGap, type BackupGap } from './gaps.js'
import { repositoryUrlOf } from './repository-url.js'
import { personalFolderShown, type PersonalFolderShown } from './shown.js'

// store-git-repository's server part (`@openagt/hooks/rpc`), a module of the computer's: Settings ›
// Your agent data. Where everything the agents keep is: the person's own folder, `~/.openagent`,
// which may sync with a repository of theirs so every machine of theirs has the same data, sent as
// one of OpenAgent's own accounts at its host, never as the person's own login. And what of the
// agents' data is not backed up, with the press that names an account for it.

export type { BackupGap } from './gaps.js'

export interface PersonalFolderView extends PersonalFolderShown {
  /** Commits made here that have not reached the repository yet. */
  unsent: number
  /** The projects of this computer that keep their agent data in it, by name. */
  projects: string[]
  /** The login of OpenAgent's account it is sent as, when it syncs. */
  account?: string
  /** OpenAgent's accounts at each host: what it may be sent as. */
  hosts: HostAccounts[]
}

/** Where the person's folder is, what it holds, and the repository it syncs with. */
export const folder = read(async (host: RpcComputerHost): Promise<PersonalFolderView> => {
  const [state, projects, hosts] = await Promise.all([readPersonalFolder(), host.projects(), host.accounts.hosts().catch((): HostAccounts[] => [])])
  const kept: string[] = []
  for (const project of projects) if (!(await readSharing(project.dir).catch(() => false))) kept.push(project.name)
  return { ...personalFolderShown(state), unsent: state.unsent, projects: kept, ...(state.account ? { account: state.account } : {}), hosts }
})

/**
 * Sync the personal folder with the person's repository, sent as `login`, one of OpenAgent's
 * accounts at its host: what it has comes in, every record here goes out. Never as the person's
 * own login: with no account there, nothing is sent.
 */
export const sync = act(async (host: RpcComputerHost, input: { address: string; login?: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
  const url = typeof input.address === 'string' ? repositoryUrlOf(input.address) : undefined
  if (!url) return { ok: false, error: 'That is not a repository address. Paste one like github.com/you/agent.' }
  const at = remoteHostOf(url)
  const account = at !== undefined ? await host.accounts.sendAs(at, input.login) : undefined
  if (account && !account.ok) return account
  return syncPersonalFolder(url, account?.account)
})

/** Send the personal folder as another of OpenAgent's accounts from now on. */
export const sendAs = act(async (host: RpcComputerHost, input: { login: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
  const remote = (await readPersonalFolder()).remote
  const at = remote ? remoteHostOf(remote) : undefined
  if (at === undefined) return { ok: false, error: 'Your folder syncs with no repository on a git host.' }
  const account = await host.accounts.sendAs(at, input.login)
  return account.ok ? sendPersonalFolderAs(account.account) : account
})

/** Stop syncing: the repository is forgotten here, every record stays on this machine and on the repository. */
export const stopSyncing = act(async (_host: RpcComputerHost, _input: object): Promise<{ ok: true } | { ok: false; error: string }> => stopSyncingPersonalFolder())

/** Everything not backed up now: the person's folder, and each shared project's data. OpenAgent's accounts that could back it up are the git hosts' own read. */
export const backup = read(async (host: RpcComputerHost): Promise<{ gaps: BackupGap[]; hosts: HostAccounts[] }> => {
  const [gaps, hosts] = await Promise.all([
    (async () => [await personalGap(), ...(await Promise.all((await host.projects()).map(project => projectGap(project))))])(),
    host.accounts.hosts().catch((): HostAccounts[] => []),
  ])
  return { gaps: gaps.filter((gap): gap is BackupGap => gap !== undefined), hosts }
})

/**
 * Back up the personal folder, or a shared project's data, as `login`, one of OpenAgent's accounts
 * at its host, from now on: what waited is sent now. A send the repository refuses leaves it as it
 * was, the reason said.
 */
export const backUp = act(async (host: RpcComputerHost, input: { kind: 'personal' | 'project'; projectId?: string; login: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
  const { kind, projectId, login } = input
  if (typeof login !== 'string' || !login) return { ok: false, error: 'Pick an account.' }
  if (kind === 'personal') {
    const sent = await sendAs(host, { login })
    return sent.ok ? sent : { ok: false, error: `Could not back up: ${sent.error.replace(/^the personal folder could not be sent to its remote: /, '')}` }
  }
  if (kind !== 'project' || typeof projectId !== 'string') return { ok: false, error: 'Nothing to back up named.' }
  const project = (await host.projects()).find(each => each.id === projectId)
  if (!project) return { ok: false, error: 'this project has no local path on this server' }
  return backUpProjectAs(project.dir, login, host.accounts)
})

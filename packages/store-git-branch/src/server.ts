import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeGitRunner, readRemoteAccount } from '@openagt/git-branches'
import { projectDataDir, readSharing } from '@openagt/store-filesystem'
import { readPersonalFolder, originHost, personalFolderShown, sendProjectDataAs, type PersonalFolderShown } from '@openagt/store-git-repository'
import { shareProjectData } from './share.js'
import type { HostAccounts } from '@openagt/hooks'
import { act, read, type RpcHost } from '@openagt/hooks/rpc'

// store-git-branch's server part (`@openagt/hooks/rpc`): Settings › Project › Project agent data.
// Where one project's agent data is, the person's own folder or the project's own branch
// `agent-data`, switched here, and what is kept there. Kept in the repository, it is sent as one of
// OpenAgent's own accounts at the remote's host, never as the person's own login.

/** One thing kept in the project's data, as its folder holds it: a folder of the modules' records, with how many it holds, or a file. */
export interface KeptData {
  name: string
  /** For a folder: how many it holds. */
  count?: number
}

export interface ProjectAgentData {
  /** `personal`: in the person's own folder; `repository`: on the project's own branch `agent-data`. */
  place: 'personal' | 'repository'
  /** The person's own folder, and the repository it syncs with, if any. */
  folder: PersonalFolderShown
  /** Whether the project has a remote to keep its data on. */
  canShare: boolean
  kept: KeptData[]
  /** The login of OpenAgent's account it is sent as, while shared. */
  account?: string
  /** OpenAgent's accounts at the remote's host: what it may be sent as. None for a remote that asks no login. */
  accounts?: HostAccounts
}

/**
 * Whether the repository at `cwd` has an `origin` remote: the one every push goes to. A remote
 * under another name counts as none, as for the data sync. A directory that is no repository has none.
 */
async function hasRemote(cwd: string): Promise<boolean> {
  return nodeGitRunner()(['remote'], cwd).then(out => out.split('\n').some(line => line.trim() === 'origin'), () => false)
}

/** What the project's data folder holds, by name: each folder with how many it holds, each file. The modules' own data, which this module names none of. */
async function keptIn(dir: string): Promise<KeptData[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const kept: KeptData[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) kept.push({ name: entry.name, count: (await readdir(join(dir, entry.name)).catch(() => [])).filter(name => !name.startsWith('.')).length })
    else if (entry.isFile()) kept.push({ name: entry.name })
  }
  return kept
}

/** Where the project's agent data is and what is kept there. */
export const data = read(async (host: RpcHost): Promise<ProjectAgentData> => {
  const root = host.root
  const [shared, canShare, state, at, account] = await Promise.all([readSharing(root).catch(() => false), hasRemote(root), readPersonalFolder(), originHost(root), readRemoteAccount(root).catch(() => undefined)])
  const accounts = at !== undefined ? ((await host.accounts.hosts().catch((): HostAccounts[] => [])).find(row => row.host === at) ?? { host: at, logins: [] }) : undefined
  const kept = await keptIn(await projectDataDir(root).catch(() => ''))
  return {
    place: shared ? 'repository' : 'personal',
    folder: personalFolderShown(state),
    canShare,
    kept,
    ...(shared && account ? { account: account.login } : {}),
    ...(accounts ? { accounts } : {}),
  }
})

/** Send the shared project's data as another of OpenAgent's accounts from now on. */
export const sendAs = act(async (host: RpcHost, input: { login: string }): Promise<{ ok: true } | { ok: false; error: string }> => sendProjectDataAs(host.root, input.login, host.accounts))

/**
 * Keep the project's data on its own repository's branch `agent-data`, sent as `login`, one of
 * OpenAgent's accounts at the remote's host: what was in the person's folder goes there and is
 * pushed now; off, back to the person's folder. A project with no remote has nothing to share
 * with, and is refused.
 */
export const share = act(async (host: RpcHost, input: { on: boolean; login?: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
  const root = host.root
  if (input.on && !(await hasRemote(root))) return { ok: false, error: 'this project has no remote to share with' }
  if (!input.on) return shareProjectData(root, false, undefined)
  // A remote in a folder on this disk asks no login.
  const at = await originHost(root)
  const account = at !== undefined ? await host.accounts.sendAs(at, input.login) : undefined
  if (account && !account.ok) return account
  return shareProjectData(root, true, account?.account)
})

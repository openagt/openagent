import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { accountGit, clearRemoteAccount, errorMessage, nodeGitRunner, readRemoteAccount, writeRemoteAccount, type RemoteAccount } from '@openagt/git-branches'
import { originUrl } from '@openagt/hooks'
import { FOLDER_BRANCH, personalFolder, plainReason, withPersonalFolder, withPersonalFolderLock, type PersonalFolderDeps } from '@openagt/store-filesystem'

// The personal folder synced with a repository of the person's: the remote it is given, how it
// stands against it, the account it is sent as, and the sync stopped. Its writes, which take in
// what the remote has and send their commits, are store-filesystem's (`personal-folder.ts`).

/** How the personal folder stands: where it is, the remote it syncs with, and its commits the remote does not have yet. */
export interface PersonalFolderState {
  path: string
  remote?: string
  /** The login of OpenAgent's account it is sent as (`remote-account.ts`). */
  account?: string
  /** Commits made here that have not reached the remote. */
  unsent: number
}

/** Whether the personal folder syncs with a repository of the person's: it has a remote. A folder not made yet syncs with none. Never throws. */
export async function personalFolderSyncs(deps: PersonalFolderDeps = {}): Promise<boolean> {
  const folder = deps.folder ?? personalFolder()
  if (!(await stat(join(folder, '.git')).then(() => true, () => false))) return false
  return (await originUrl(folder, deps.git ?? nodeGitRunner())) !== undefined
}

/** Read how the personal folder stands, without changing it. A folder not made yet holds nothing. Never throws. */
export async function readPersonalFolder(deps: PersonalFolderDeps = {}): Promise<PersonalFolderState> {
  const git = deps.git ?? nodeGitRunner()
  const folder = deps.folder ?? personalFolder()
  const made = await stat(join(folder, '.git')).then(() => true, () => false)
  if (!made) return { path: folder, unsent: 0 }
  const remote = await originUrl(folder, git)
  const unsent = remote
    ? await git(['rev-list', '--count', `refs/remotes/origin/${FOLDER_BRANCH}..HEAD`], folder).then(
        out => Number(out.trim()) || 0,
        // Nothing on the remote yet: every commit but the first, which carries nothing, is unsent.
        async () => Math.max(0, Number((await git(['rev-list', '--count', 'HEAD'], folder).catch(() => '1')).trim()) - 1),
      )
    : 0
  const account = (await readRemoteAccount(folder, git).catch(() => undefined))?.login
  return { path: folder, ...(remote ? { remote } : {}), ...(account ? { account } : {}), unsent }
}

/**
 * Sync the personal folder with a repository, sent as `account`, one of OpenAgent's own (none for
 * a repository in a folder on this disk, which asks no login): the remote is set, what it already
 * has (another machine's records) is merged in, and every commit here is sent. A remote that cannot
 * be reached or refuses is said, and the folder is left with no remote and no account, as it was.
 */
export async function syncPersonalFolder(address: string, account: RemoteAccount | undefined, deps: PersonalFolderDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const plain = deps.git ?? nodeGitRunner()
  const git = accountGit(plain)
  const folder = deps.folder ?? personalFolder()
  if (!address.trim() || address.trim().startsWith('-')) return { ok: false, error: 'no repository address given' }
  const made = await withPersonalFolder(folder, 'sync', async () => {}, deps)
  if (!made.ok) return { ok: false, error: made.error }
  const undo = async () => {
    await plain(['remote', 'remove', 'origin'], folder).catch(() => {})
    await clearRemoteAccount(folder, plain)
  }
  await undo()
  await plain(['remote', 'add', 'origin', address.trim()], folder)
  if (account) await writeRemoteAccount(folder, account, plain)
  const reached = await git(['ls-remote', '--heads', 'origin'], folder).then(() => undefined, errorMessage)
  if (reached !== undefined) {
    await undo()
    return { ok: false, error: `the repository could not be reached: ${plainReason(reached)}` }
  }
  const sent = await withPersonalFolder(folder, 'sync', async () => {}, deps)
  if (sent.ok) return { ok: true }
  await undo()
  return { ok: false, error: sent.error }
}

/**
 * Send the personal folder as another of OpenAgent's accounts from now on, and send what waits now.
 * A send the repository refuses leaves the folder sent as it was, the reason said.
 */
export async function sendPersonalFolderAs(account: RemoteAccount, deps: PersonalFolderDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const git = deps.git ?? nodeGitRunner()
  const folder = deps.folder ?? personalFolder()
  if (!(await originUrl(folder, git))) return { ok: false, error: 'the personal folder syncs with no repository' }
  const before = await readRemoteAccount(folder, git).catch(() => undefined)
  const named = await withPersonalFolderLock(folder, deps, () => writeRemoteAccount(folder, account, git)).then(
    () => undefined,
    err => errorMessage(err),
  )
  if (named !== undefined) return { ok: false, error: named }
  const sent = await withPersonalFolder(folder, 'sync', async () => {}, deps)
  if (sent.ok) return { ok: true }
  await withPersonalFolderLock(folder, deps, () => (before ? writeRemoteAccount(folder, before, git) : clearRemoteAccount(folder, git))).catch(() => {})
  return { ok: false, error: sent.error }
}

/** Stop syncing the personal folder: the remote is forgotten, every record stays here. */
export async function stopSyncingPersonalFolder(deps: PersonalFolderDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const git = deps.git ?? nodeGitRunner()
  const folder = deps.folder ?? personalFolder()
  return withPersonalFolderLock(folder, deps, async () => {
    await git(['remote', 'remove', 'origin'], folder).catch(() => {})
    await clearRemoteAccount(folder, git)
    return { ok: true as const }
  }).catch(err => ({ ok: false as const, error: errorMessage(err) }))
}

import { clearRemoteAccount, originUrl, pullProjectData, readPersonalFolder, readRemoteAccount, readSharing, remoteHostOf, repositoryAddress, shareProjectDataAs, writeRemoteAccount } from '@openagt/agent-data'
import type { GitAccounts, ProjectRef } from '@openagt/hooks'
import { personalFolderShown } from './shown.js'

// What is not backed up: the agents' data that syncs with a repository at a git host, with no
// account of OpenAgent's named to send it as. Its changes are made all the same and wait on this
// computer (`withPersonalFolder`); they are said once, with the press that names an account, never
// as a failure of each change. The person's own folder, and each project of this computer whose
// data is shared on its own repository (store-git-branch says those need the person).

/** Data that is not backed up. */
export interface BackupGap {
  /** The person's own folder, or one shared project's data. */
  kind: 'personal' | 'project'
  /** The project, for a shared project's data. */
  projectId?: string
  /** The project's name, for a shared project's data. */
  project?: string
  /** The repository it syncs with, as shown: `github.com/me/agent`. */
  address: string
  /** The repository's page, when it has one. */
  url?: string
  /** The git host it is sent to. */
  host: string
  /** Changes made here that wait, when they can be counted. */
  waiting?: number
}

/** The host the repository at `root` has its origin on; none for no origin, or one in a folder on this disk. */
export async function originHost(root: string): Promise<string | undefined> {
  const url = await originUrl(root)
  return url ? remoteHostOf(url) : undefined
}

/** The person's own folder, when it syncs with a repository at a git host and no account of OpenAgent's is named to send it as. */
export async function personalGap(): Promise<BackupGap | undefined> {
  const state = await readPersonalFolder()
  const host = state.remote ? remoteHostOf(state.remote) : undefined
  if (host === undefined || state.account) return undefined
  const shown = personalFolderShown(state)
  return { kind: 'personal', address: shown.remote ?? state.remote!, ...(shown.remoteUrl ? { url: shown.remoteUrl } : {}), host, waiting: state.unsent }
}

/** A project's data, when it is shared on its repository at a git host and no account of OpenAgent's is named to send it as. */
export async function projectGap(project: ProjectRef): Promise<BackupGap | undefined> {
  if (!(await readSharing(project.dir).catch(() => false))) return undefined
  const host = await originHost(project.dir).catch(() => undefined)
  if (host === undefined || (await readRemoteAccount(project.dir).catch(() => undefined))) return undefined
  const address = await repositoryAddress(project.dir).catch(() => undefined)
  return { kind: 'project', projectId: project.id, project: project.name, address: address ?? host, ...(address ? { url: `https://${address}` } : {}), host }
}

/** Send the shared data of the project at `root` as `login`, one of OpenAgent's accounts at its origin's host, from now on. */
export async function sendProjectDataAs(root: string, login: string, accounts: GitAccounts): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = await originHost(root)
  if (host === undefined) return { ok: false, error: 'This project is sent to no git host.' }
  const account = await accounts.sendAs(host, login)
  return account.ok ? shareProjectDataAs(root, account.account) : account
}

/** What git said went wrong, as a person reads it: its last line, not the command it ran. */
function gitReason(error: string): string {
  return (error.trim().split('\n').at(-1) ?? error).replace(/^(fatal|error): /, '')
}

/**
 * Back up the shared data of the project at `root` as `login` from now on: what waited is sent
 * now. A send the repository refuses leaves the account it had, the reason said.
 */
export async function backUpProjectAs(root: string, login: string, accounts: GitAccounts): Promise<{ ok: true } | { ok: false; error: string }> {
  const before = await readRemoteAccount(root).catch(() => undefined)
  const named = await sendProjectDataAs(root, login, accounts)
  if (!named.ok) return named
  const sent = await pullProjectData(root)
  if (sent.ok) return { ok: true }
  await (before ? writeRemoteAccount(root, before) : clearRemoteAccount(root)).catch(() => {})
  return { ok: false, error: `Could not back up: ${gitReason(sent.error)}` }
}

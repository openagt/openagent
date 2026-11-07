import { clearRemoteAccount, pullProjectData, readPersonalFolder, readRemoteAccount, readSharing, remoteHostOf, repositoryAddress, writeRemoteAccount } from '@openagt/agent-data'
import { contextProjects, resolveProjectPath } from './context.js'
import { originHost } from './send-as.js'
import { sendPersonalFolderAs } from './personal-folder.js'
import { sendProjectDataAs } from './project-agent-data.js'
import { providedDataChanged } from '../store/provided.js'
import { personalFolderShown } from '../personal-folder-shown.js'

// What is not backed up: the agents' data that syncs with a repository at a git host, with no
// account of OpenAgent's named to send it as. Its changes are made all the same and wait on this
// computer (`withPersonalFolder`); they are said here, once, with the press that names an account,
// never as a failure of each change. The person's own folder, and each project of this computer
// whose data is shared on its own repository.

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

export interface BackupView {
  gaps: BackupGap[]
}

/** Everything not backed up now. OpenAgent's accounts that could back it up are the git hosts' own read (`onGitHosts`). */
export async function onBackup(): Promise<BackupView> {
  const [state, projects] = await Promise.all([readPersonalFolder(), contextProjects().list()])
  const gaps: BackupGap[] = []
  const personalHost = state.remote ? remoteHostOf(state.remote) : undefined
  if (personalHost !== undefined && !state.account) {
    const shown = personalFolderShown(state)
    gaps.push({ kind: 'personal', address: shown.remote ?? state.remote!, ...(shown.remoteUrl ? { url: shown.remoteUrl } : {}), host: personalHost, waiting: state.unsent })
  }
  for (const project of projects) {
    if (project.machine !== undefined) continue
    if (!(await readSharing(project.path).catch(() => false))) continue
    const host = await originHost(project.path).catch(() => undefined)
    if (host === undefined || (await readRemoteAccount(project.path).catch(() => undefined))) continue
    const address = await repositoryAddress(project.path).catch(() => undefined)
    gaps.push({ kind: 'project', projectId: project.id, project: project.name, address: address ?? host, ...(address ? { url: `https://${address}` } : {}), host })
  }
  return { gaps }
}

/** What git said went wrong, as a person reads it: its last line, not the command it ran. */
function gitReason(error: string): string {
  return (error.trim().split('\n').at(-1) ?? error).replace(/^(fatal|error): /, '')
}

/**
 * Back up `gap` as `login`, one of OpenAgent's accounts at its host, from now on: what waited is
 * sent now. A send the repository refuses leaves it as it was, the reason said.
 */
export async function sendBackUpAs(gap: { kind: 'personal' | 'project'; projectId?: string }, login: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof login !== 'string' || !login) return { ok: false, error: 'Pick an account.' }
  if (gap?.kind === 'personal') {
    const sent = await sendPersonalFolderAs(login)
    return sent.ok ? sent : { ok: false, error: `Could not back up: ${sent.error.replace(/^the personal folder could not be sent to its remote: /, '')}` }
  }
  if (gap?.kind !== 'project' || typeof gap.projectId !== 'string') return { ok: false, error: 'Nothing to back up named.' }
  const root = await resolveProjectPath(gap.projectId)
  if (!root) return { ok: false, error: 'this project has no local path on this server' }
  const before = await readRemoteAccount(root).catch(() => undefined)
  const named = await sendProjectDataAs(gap.projectId, login)
  if (!named.ok) return named
  const sent = await pullProjectData(root)
  if (!sent.ok) {
    await (before ? writeRemoteAccount(root, before) : clearRemoteAccount(root)).catch(() => {})
    return { ok: false, error: `Could not back up: ${gitReason(sent.error)}` }
  }
  providedDataChanged(root)
  return { ok: true }
}

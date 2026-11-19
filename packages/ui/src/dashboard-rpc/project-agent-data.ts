import { readPersonalFolder, readRemoteAccount, readSharing, shareProjectDataAs } from '@openagt/agent-data'
import { accountsByHost, originHost, remoteAccount, type SendAsHost } from './send-as.js'
import { resolveProjectPath } from './context.js'
import { hasRemote } from '../has-remote.js'
import { providedCommand } from '../built-in.js'
import { projectQueue } from '../store/queue.js'
import { projectRuns } from '../store/runs.js'
import { projectTickets } from '../store/tickets.js'
import { personalFolderShown, type PersonalFolderShown } from '../personal-folder-shown.js'

// Settings › Project › Project agent data: where one project's agent data is, and what is kept there.
// OpenAgent knows nothing of the files themselves: what is kept is what each skill that provides
// a kind of the data answers, the same reads the project's pages make.

/** One kind of the project's data the skills keep: how many, and the skill that keeps them. */
export interface KeptData {
  kind: 'runs' | 'tickets' | 'queue'
  count: number
  /** The providing package's name as a person knows the skill (`logs` for `@openagt/skill-logs`). */
  skill: string
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
  accounts?: SendAsHost
}

/** The skill's name of a package: `@openagt/skill-logs` reads `logs`. */
function skillName(pkg: string): string {
  return pkg.replace(/^@[^/]+\//, '').replace(/^skill-/, '')
}

/** Where the project's agent data is and what is kept; `null` for a project with no folder on this computer. */
export async function onProjectAgentData(projectId: string): Promise<ProjectAgentData | null> {
  const root = await resolveProjectPath(projectId)
  if (!root) return null
  const [shared, canShare, state, host, account] = await Promise.all([readSharing(root).catch(() => false), hasRemote(root), readPersonalFolder(), originHost(root), readRemoteAccount(root).catch(() => undefined)])
  const accounts = host !== undefined ? ((await accountsByHost().catch((): SendAsHost[] => [])).find(row => row.host === host) ?? { host, logins: [] }) : undefined
  const kinds = [
    { kind: 'runs' as const, count: async () => (await (await projectRuns(root))?.list())?.length },
    { kind: 'tickets' as const, count: async () => (await (await projectTickets(root))?.list())?.length },
    { kind: 'queue' as const, count: async () => (await (await projectQueue(root))?.list())?.length },
  ]
  const kept: KeptData[] = []
  for (const { kind, count } of kinds) {
    const command = await providedCommand(root, kind).catch(() => undefined)
    const n = command ? await count().catch(() => undefined) : undefined
    if (command && n !== undefined) kept.push({ kind, count: n, skill: skillName(command.package) })
  }
  return {
    place: shared ? 'repository' : 'personal',
    folder: personalFolderShown(state),
    canShare,
    kept,
    ...(shared && account ? { account: account.login } : {}),
    ...(accounts ? { accounts } : {}),
  }
}

/** Send the shared project's data as another of OpenAgent's accounts from now on. */
export async function sendProjectDataAs(projectId: string, login: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const root = await resolveProjectPath(projectId)
  if (!root) return { ok: false, error: 'this project has no local path on this server' }
  const host = await originHost(root)
  if (host === undefined) return { ok: false, error: 'This project is sent to no git host.' }
  const account = await remoteAccount(host, login)
  return account.ok ? shareProjectDataAs(root, account.account) : account
}

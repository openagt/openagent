import { contextHost, contextOtherHosts, contextPrepareStart, contextProjectState, contextProjects, contextStartedIn, resolveProjectPath } from './context.js'
import { projectRefAt } from '../distribution-hooks.js'
import { readProjectSkills } from '@openagt/skills'
import { DATA_BRANCH, errorMessage, isRepoOwner, originDefaultBranch, readRepoOwners, repositoryAddress, shareProjectData, writeRepoOwners } from '@openagt/agent-data'
import { readHosted, refreshHosted, type HostedRead } from './hosted-repos.js'
import { originGit, originHost, remoteAccount } from './send-as.js'
import type { StartReadiness } from '../start-readiness.js'
import { SESSIONS_ID } from '../project-address.js'
import { hasRemote } from '../has-remote.js'
import { openagentVersion } from '../version.js'
import { currentBranch } from '../dashboard/git-status.js'
import { branchesOnOrigin, waitingSkills } from '../dashboard/start-branch.js'
import { readFolderBehind, updateFolder, type FolderBehind } from '../dashboard/folder-behind.js'
import { startFromPick, type StartFromPick } from '../registry.js'
import { projectGitHost } from '../store/git-host.js'
import type { ProjectSummary } from '../dashboard/projects.js'
import type { StartedInResult } from '../dashboard/types.js'

// The Projects sidebar behind the new dashboard (#405): the list of projects the projects module
// keeps (`PROJECTS`) — id, path, name, activated, last activity. The live event stream is its
// own endpoint rather than a call (`GET /_rpc/events`).
//
// Each project also carries what the person has to fix there (#1500), what the modules on in it
// say needs setting up: a data branch that cannot reach origin, say (#1599); and why its data stays
// on this machine, if it does. Both ride this list rather than a read of their own because the
// list is what every project surface already polls, so an error reaches the sidebar dot and the
// project's banner with nothing new to subscribe to.
export async function onProjects(): Promise<ProjectSummary[]> {
  const state = contextProjectState()
  return Promise.all(
    (await contextProjects().list()).map(async project => {
      const { errors, local } = await state(project)
      return { ...project, ...(errors.length > 0 ? { errors } : {}), ...(local ? { local } : {}) }
    }),
  )
}

/**
 * A second `openagent` started while this dashboard listens on its port (#2141): it serves
 * nothing itself, and hands over the folder it was started in. The answer says which OpenAgent
 * runs here, and the project that holds the folder, else the repository it is in, added; no
 * project outside a repository. A page's own call is answered the same, and adds no more than Add
 * project.
 */
export async function sendStartedAgain(folder: string | null): Promise<{ version: string; project?: StartedInResult }> {
  const startedIn = contextStartedIn()
  const version = openagentVersion()
  if (typeof folder !== 'string' || !folder.trim()) return { version }
  const project = await startedIn(folder)
  return project ? { version, project } : { version }
}

/**
 * The person's switch: share the project's records with its remote, or keep them on this machine.
 * The records move with the switch: on, from the personal folder to the project's branch, sent at
 * once, so a remote that refuses is said at once and the switch goes back to off with the records
 * where they were; off, back to the personal folder. A project with no remote has nothing to
 * share with, and is refused.
 */
export async function sendShareRecords(projectId: string, on: boolean, login?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  if (on && !(await hasRemote(cwd))) return { ok: false, error: 'this project has no remote to share with' }
  if (!on) return shareProjectData(cwd, false, undefined)
  // Sent as one of OpenAgent's accounts at the remote's host, never the person's own login; a remote in a folder on this disk asks none.
  const host = await originHost(cwd)
  const account = host !== undefined ? await remoteAccount(host, login) : undefined
  if (account && !account.ok) return account
  return shareProjectData(cwd, true, account?.account)
}

/**
 * The repositories at the git hosts the project picker lists beside this computer's: the accounts'
 * and those of the owners Settings › Repos on GitHub names, as kept, while one still being read
 * says so. The shell's own `composer.where` (`shell-where.ts`) until the github module offers them.
 */
export async function onHostedRepos(): Promise<HostedRead> {
  return readHosted()
}

/** Settings › Repos on GitHub: the users and organizations at a git host whose repositories are listed, as `<host>/<name>`. */
export async function onRepoOwners(): Promise<string[]> {
  return readRepoOwners()
}

/** List one more user's or organization's repositories: `vikejs`, `github.com/vikejs` or its page's address. GitHub when no host is named. */
export async function sendAddRepoOwner(typed: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const said = typeof typed === 'string' ? typed.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') : ''
  const owner = said.includes('/') ? said.replace(/^([^/]+)/, host => host.toLowerCase()) : `github.com/${said.replace(/^@/, '')}`
  if (!isRepoOwner(owner)) return { ok: false, error: `"${said.slice(0, 80)}" is not a user or organization. One looks like vikejs, or github.com/vikejs.` }
  const owners = await readRepoOwners()
  if (owners.some(one => one.toLowerCase() === owner.toLowerCase())) return { ok: true }
  const written = await writeRepoOwners([...owners, owner])
  if (!written.ok) return { ok: false, error: written.error }
  void refreshHosted()
  return { ok: true }
}

/** Stop listing an owner's repositories. */
export async function sendRemoveRepoOwner(owner: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const owners = await readRepoOwners()
  if (!owners.includes(owner)) return { ok: true }
  const written = await writeRepoOwners(owners.filter(one => one !== owner))
  if (!written.ok) return { ok: false, error: written.error }
  void refreshHosted()
  return { ok: true }
}

/**
 * One of the project's commands (#1774) as the launcher offers it: a skill of the project's own
 * written to be run by a person (skills' `command`), typed after the slash. OpenAgent ships no
 * prompt text; what a project can be asked to do is what its own command skills say.
 */
export interface ProjectCommand {
  /** What is typed after the slash: the skill's folder name. */
  name: string
  /** The `description` of the skill's front matter, when it has one. */
  description?: string
  /** The branch the skill has yet to reach, by name, when its text is in the folder but not on the branch agents start from: an agent started from that branch does not have the command. */
  waiting?: string
}

/** What the launcher offers for a project: its commands, and how far its runs can go. */
export interface ProjectLauncher {
  commands: ProjectCommand[]
  /** Whether one of the project's packages provides a git host; without one no pull request can be opened, so the publish menu stops at the branch. */
  gitHost: boolean
  /** Whether the project's repository has an `origin` remote; without one nothing can be published, so the publish menu stops at the commit. */
  remote: boolean
  /** The address the project's repository was cloned from (`github.com/acme/shop`): its host is the git host a session pushes to, as the account it picks there. */
  address?: string
  /**
   * What the launcher's branch menu always lists: `main`, the name of origin's default branch, and
   * `local`, the branch the project's folder is on now. Absent where a pick could not be obeyed:
   * the repository has no remote, or the folder is on no branch. The rest of the menu is
   * {@link onStartBranches}.
   */
  startFrom?: { main: string; local: string }
}

/**
 * The project's commands (#1774), read off its skills folders, whether it has a git host, and the
 * branches an agent can start from. `from` is the person's pick of those
 * branches: a command is waiting for the branch agents will start from. `null` when the project is
 * unknown here.
 */
export async function onCommands(projectId: string, from?: StartFromPick): Promise<ProjectLauncher | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const [skills, gitHost, remote, address, main, local] = await Promise.all([readProjectSkills(cwd), projectGitHost(cwd).catch(() => undefined), hasRemote(cwd), repositoryAddress(cwd), originDefaultBranch(cwd), currentBranch(cwd)])
  const commands = skills.filter(skill => skill.command).map(({ name, description }): ProjectCommand => ({ name, ...(description !== undefined ? { description } : {}) }))
  // Both read locally, never fetched. `HEAD` is a folder on no branch: there is no local branch to start from.
  const startFrom = remote && main !== undefined && local !== undefined && local !== 'HEAD' ? { main: main.slice('origin/'.length), local } : undefined
  // A skill written into the folder reaches agents once it is on the branch they start from: until then its command is said to be waiting.
  const pick = startFrom ? startFromPick(from) : undefined
  const { waiting } = await waitingSkills(cwd, commands.map(command => command.name), pick)
  const listed = commands.map(command => {
    const waits = waiting.get(command.name)
    return waits ? { ...command, waiting: waits.branch } : command
  })
  return { commands: listed, gitHost: gitHost !== undefined, remote, ...(address ? { address } : {}), ...(startFrom ? { startFrom } : {}) }
}

/**
 * How far the project's folder is behind its remote's main branch (#2421); `null` when it is not, or
 * for a project with no folder here. Origin is asked as one of OpenAgent's accounts, never the
 * person's own login; where it cannot be asked, the clone's own copy of the branch is what counts.
 */
export async function onFolderBehind(projectId: string): Promise<FolderBehind | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const origin = await originGit(cwd).catch(() => undefined)
  return (await readFolderBehind(cwd, { origin })) ?? null
}

/** Bring the project's folder up to its remote's main branch: a fast-forward, or git's refusal in its words. */
export async function sendUpdateFolder(projectId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  return updateFolder(cwd)
}

/** The other branches the launcher's menu lists; `branches` is absent where origin could not be read. */
export interface StartBranches {
  branches?: string[]
}

/**
 * The branches an agent can start from besides the two `onCommands` names, read live from origin
 * each time the launcher's menu opens: all of origin's but its main branch, which the menu lists
 * first, and the branch that holds the runs' records, which is no code to start from. `null` when
 * the project is unknown here.
 */
export async function onStartBranches(projectId: string): Promise<StartBranches | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const [listed, main] = await Promise.all([branchesOnOrigin(cwd), originDefaultBranch(cwd)])
  if (!listed) return {}
  return { branches: listed.filter(branch => branch !== DATA_BRANCH && `origin/${branch}` !== main) }
}

/** A host a run may be picked to run on beside this computer's (`run.host`, #2394): its id, and its name in the "Run on" menu. */
export interface RunHostChoice {
  id: string
  label: string
}

/**
 * The hosts a run in this project may be picked to run on beside this computer's, those of its
 * modules that are on there, in the distribution's order: none for a session with no project, or a
 * project unknown here.
 */
export async function onRunHosts(projectId: string): Promise<RunHostChoice[]> {
  const cwd = projectId === SESSIONS_ID ? undefined : await resolveProjectPath(projectId)
  if (!cwd) return []
  const hosts = await contextOtherHosts(await projectRefAt(projectId, cwd)).catch(() => [])
  return hosts.map(host => ({ id: host.id, label: host.label }))
}

/**
 * What would stop a run in this project before it spends a checkout, said in the launcher before
 * the Start: the check of the host it runs on (`run.host`, #2394), this computer's unless `host`
 * names another, given the coding agent picked. A missing CLI or a logged-out one is a problem the
 * run itself would refuse on; a warning is said and blocks nothing. A check that fails is said as a
 * warning: it is a broken check, not a reason to stop. `null` for an unknown project or host, or a
 * host with no check: nothing to say.
 */
export async function onStartCheck(projectId: string, driver?: string, host?: string): Promise<StartReadiness | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  // The launcher asks this as it opens and at each change of agent: a Start is near, on this agent.
  contextPrepareStart()(projectId, typeof driver === 'string' ? driver : undefined)
  const project = projectId === SESSIONS_ID ? undefined : await projectRefAt(projectId, cwd)
  const here = contextHost()
  const checks = typeof host !== 'string' || host === here.id ? here : (await contextOtherHosts(project).catch(() => [])).find(other => other.id === host)
  if (!checks?.check) return null
  try {
    const options = typeof driver === 'string' ? { 'agent-driver': { driver } } : {}
    const checked = await checks.check(project ? { project, options } : { options })
    return { problems: checked.problems, warnings: checked.warnings, ...(checked.fix ? { fix: checked.fix } : {}) }
  } catch (err) {
    return { problems: [], warnings: [errorMessage(err)] }
  }
}



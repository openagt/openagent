import { contextAddProject, contextHost, contextOtherHosts, contextPrepareStart, contextProjectState, contextProjects, contextRemoveProject, contextStartedIn, resolveProjectPath } from './context.js'
import { projectRefAt } from '../distribution-hooks.js'
import { DATA_BRANCH, addressOfRemote, errorMessage, isRepoOwner, originDefaultBranch, readRepoOwners, repositoryAddress, shareProjectData, writeRepoOwners } from '@openagt/agent-data'
import { readHosted, refreshHosted, type HostedRepo } from './hosted-repos.js'
import { cloneAccountFor, originGit, originHost, remoteAccount } from './send-as.js'
import type { StartReadiness } from '../start-readiness.js'
import { SESSIONS_ID } from '../project-address.js'
import { hasRemote } from '../has-remote.js'
import { openagentVersion } from '../version.js'
import { currentBranch } from '../dashboard/git-status.js'
import { branchesOnOrigin } from '../dashboard/start-branch.js'
import { readFolderBehind, updateFolder, type FolderBehind } from '../dashboard/folder-behind.js'
import { addRepoFolder, listProjects, listRepoFolders, removeRepoFolder } from '../registry.js'
import { thisComputersRepos, type FoundRepo } from '../dashboard/repos.js'
import { cloneProject, cloneTargetOf } from '../clone-project.js'
import { canPickDirectory, pickDirectory, type PickDirectoryResult } from '../pick-directory.js'
import { projectGitHost } from '../store/git-host.js'
import type { ProjectSummary } from '../dashboard/projects.js'
import type { AddProjectResult, RemoveProjectResult, StartedInResult } from '../dashboard/types.js'

// The Projects sidebar behind the new dashboard (#405): the global registry (#390) the
// daemon and CLI write — id, path, name, activated, last activity. The live event stream is its
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
 * Add a project from the dashboard (#396/#433): install the repo and register it so it joins the
 * Projects list. Like `sendStart` this needs the daemon (it spawns git + writes the shared
 * registry), so it calls the daemon's own `addProject` closure off the wired dashboard context.
 * Returns the daemon's {@link AddProjectResult}.
 * The agents' records stay on this machine; the project's Agent data page shares them later.
 */
export async function sendAddProject(path: string): Promise<AddProjectResult> {
  // Throws on an unwired context (D3), like `sendStart`: a missing capability is a wiring bug.
  const addProject = contextAddProject()
  const trimmed = path.trim()
  if (!trimmed) return { ok: false, error: 'a project path is required' }
  return addProject(trimmed, false)
}

/**
 * A second `openagent` started while this dashboard listens on its port (#2141): it serves
 * nothing itself, and hands over the folder it was started in, if it is in a repository. The
 * answer says which OpenAgent runs here, and the project that holds the folder, else the folder,
 * added. A page's own call is answered the same, and adds no more than Add project.
 */
export async function sendStartedAgain(folder: string | null): Promise<{ version: string; project?: StartedInResult }> {
  const startedIn = contextStartedIn()
  const version = openagentVersion()
  if (typeof folder !== 'string' || !folder.trim()) return { version }
  return { version, project: await startedIn(folder) }
}

/** Where the repository a person typed the address of would be cloned to on this computer, or why what was typed is no address: asked before anything is cloned. */
export async function onCloneTarget(address: string): Promise<{ ok: true; address: string; path: string } | { ok: false; error: string }> {
  return cloneTargetOf(typeof address === 'string' ? address : '')
}

/**
 * Add a project by its repository's address, for a computer that does not have its folder: the
 * repository is cloned into `~/projects/<its name>` with the logins this computer has, and the
 * folder is then added as {@link sendAddProject} adds one. A folder already there with this
 * repository in it is added as it is. The answer says where the project is.
 */
export async function sendAddProjectFromAddress(address: string): Promise<AddProjectResult> {
  const addProject = contextAddProject()
  const typed = typeof address === 'string' ? address : ''
  const account = await cloneAccountFor(typed)
  const cloned = await cloneProject(typed, account ? { account } : {})
  if (!cloned.ok) return cloned
  const added = await addProject(cloned.path, false)
  return added.ok ? { ...added, path: cloned.path } : added
}

/**
 * Remove a project from the dashboard: it leaves the Projects list. Nothing in its folder is
 * deleted unless `files` is true: then what OpenAgent left there is removed too, and the answer
 * says what went and what stayed. Like `sendAddProject` this is the daemon's to do (it runs the project's close hooks and
 * writes the shared registry), so it calls the daemon's own closure off the wired dashboard context.
 * Addressed by id and not by path, so a project whose folder is gone can still be removed.
 */
export async function sendRemoveProject(projectId: string, files: boolean): Promise<RemoveProjectResult> {
  const removeProject = contextRemoveProject()
  if (typeof projectId !== 'string' || !projectId) return { ok: false, error: 'a project id is required' }
  return removeProject(projectId, files === true)
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
 * Open the OS folder picker on the daemon's machine and wait for the user's choice (#1150). The
 * browser cannot learn an absolute path from any picker of its own, and the daemon — which runs on
 * the machine the user is sitting at — can, so the dialog is the daemon's. A dismissed dialog
 * comes back as `path: null`.
 */
export async function sendPickProjectDirectory(): Promise<PickDirectoryResult> {
  return pickDirectory()
}

/** The repos on this computer that are not projects yet, the ones at the git hosts not here, and whether a folder can be added to look in. */
export interface ReposRead {
  repos: FoundRepo[]
  /** The repositories OpenAgent's accounts and the owners the person named have at the hosts, none of them on this computer: picked, one is cloned. */
  hosted: HostedRepo[]
  /** The look through this computer was cut short, and one with more time is on its way: the picker asks again shortly. */
  reposLoading: boolean
  /** The hosts are being asked: the picker asks again shortly. */
  hostedLoading: boolean
  /** A host did not answer the last time it was asked: the picker says its repos are missing. */
  hostedUnreached?: true
  /** This computer can show a folder dialog, so the picker offers "Search another folder…". */
  canAddFolder: boolean
}

/**
 * The repos a new session can start in besides the projects (Rom's "a project is a sticky repo"):
 * every repository the daemon's crawl found on this computer, less those that are projects
 * already. The kept list, so the picker opens at once; an old one is crawled again behind it.
 */
export async function onRepos(): Promise<ReposRead> {
  const [found, projects, hosted] = await Promise.all([thisComputersRepos().read(), listProjects(), readHosted()])
  const repos = found.repos
  const pinned = new Set(projects.map(project => project.path))
  // A repository at a host that is here already, as a repo or a project, is listed once: by its folder.
  const here = new Set<string>()
  for (const repo of repos) if (repo.url && addressOfRemote(repo.url)) here.add(addressOfRemote(repo.url)!)
  for (const project of projects) {
    const address = await repositoryAddress(project.path).catch(() => undefined)
    if (address) here.add(address)
  }
  return {
    repos: repos.filter(repo => !pinned.has(repo.path)),
    hosted: hosted.repos.filter(repo => !here.has(repo.address.toLowerCase())),
    reposLoading: found.looking,
    hostedLoading: hosted.loading,
    ...(hosted.unreached ? { hostedUnreached: hosted.unreached } : {}),
    canAddFolder: canPickDirectory(),
  }
}

/** Settings › Repos: where repos are looked for, on this computer and at the git hosts. */
export interface RepoSources {
  /** The folders the person added, looked in beside the home folder. */
  folders: string[]
  /** The users and organizations at a git host whose repositories are listed, as `<host>/<name>`. */
  owners: string[]
}

export async function onRepoSources(): Promise<RepoSources> {
  const [folders, owners] = await Promise.all([listRepoFolders(), readRepoOwners()])
  return { folders, owners }
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

/** Stop looking for repos in a folder the person added. */
export async function sendRemoveRepoFolder(folder: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof folder !== 'string') return { ok: false, error: 'no folder named' }
  await removeRepoFolder(folder)
  await thisComputersRepos().refresh()
  return { ok: true }
}

/**
 * "Search another folder…": the OS folder dialog, and the folder picked joins those the crawl
 * looks in, which then runs again before the answer. A dismissed dialog adds nothing.
 */
export async function sendAddRepoFolder(): Promise<{ ok: true; added: boolean } | { ok: false; error: string }> {
  const picked = await pickDirectory()
  if (!picked.ok) return picked
  if (!picked.path) return { ok: true, added: false }
  await addRepoFolder(picked.path)
  await thisComputersRepos().refresh()
  return { ok: true, added: true }
}

/** What the launcher offers for a project: how far its runs can go, and the branches they start from. */
export interface ProjectLauncher {
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
 * What the launcher offers for a project: whether it has a git host, and the branches an agent can
 * start from. `null` when the project is unknown here.
 */
export async function onCommands(projectId: string): Promise<ProjectLauncher | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const [gitHost, remote, address, main, local] = await Promise.all([projectGitHost(cwd).catch(() => undefined), hasRemote(cwd), repositoryAddress(cwd), originDefaultBranch(cwd), currentBranch(cwd)])
  // Both read locally, never fetched. `HEAD` is a folder on no branch: there is no local branch to start from.
  const startFrom = remote && main !== undefined && local !== undefined && local !== 'HEAD' ? { main: main.slice('origin/'.length), local } : undefined
  return { gitHost: gitHost !== undefined, remote, ...(address ? { address } : {}), ...(startFrom ? { startFrom } : {}) }
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



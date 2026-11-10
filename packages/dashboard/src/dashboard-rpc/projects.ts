import { contextAddProject, contextPrepareStart, contextProjectErrors, contextProjects, contextRemote, contextRemoveProject, contextStartedIn, resolveProjectPath } from './context.js'
import { readProjectCommands, type ProjectCommand } from '../project-commands.js'
import { DATA_BRANCH, addressOfRemote, isRepoOwner, originDefaultBranch, readRepoOwners, readSharing, repositoryAddress, repositorySpelling, shareProjectData, writeRepoOwners } from '@openagt/agent-data'
import { readHosted, refreshHosted, type HostedRepo } from './hosted-repos.js'
import { cloneAccountFor, originHost, remoteAccount } from './send-as.js'
import { readProjectHooks, runCheckHook, startLineTakesBase, startLineTakesPrBase, type StartReadiness } from '../project-hooks.js'
import { hasRemote } from '../has-remote.js'
import { openagentVersion } from '../version.js'
import { currentBranch } from '../dashboard/git-status.js'
import { branchesOnOrigin, waitingSkills } from '../dashboard/start-branch.js'
import { addRepoFolder, listProjects, listRepoFolders, removeRepoFolder, startFromPick, type StartFromPick } from '../registry.js'
import { thisComputersRepos, type FoundRepo } from '../dashboard/repos.js'
import { canRead, cloneProject, cloneTargetOf } from '../clone-project.js'
import { isDriverName } from '../driver-names.js'
import { loginsWiring } from './logins.js'
import { canPickDirectory, pickDirectory, type PickDirectoryResult } from '../pick-directory.js'
import { projectGitHost } from '../store/git-host.js'
import { readProjectPages } from '../project-modules.js'
import type { ProjectSummary } from '../dashboard/projects.js'
import type { OwnProject } from '../dashboard/elsewhere.js'
import type { AddProjectResult, RemoveProjectResult, StartedInResult } from '../dashboard/types.js'

// The Projects sidebar behind the new dashboard (#405): the global registry (#390) the
// daemon and CLI write — id, path, name, activated, last activity. The live event stream is its
// own endpoint rather than a call (`GET /_rpc/events`).
//
// Each project also carries what the daemon's background jobs found wrong with it (#1500) —
// a data branch that cannot reach origin, say (#1599) — and why its data stays on this machine, if it does.
// Both ride this list rather than a read of their own because the list is what every project
// surface already polls, so an error reaches the sidebar dot and the project's banner with
// nothing new to subscribe to.
export async function onProjects(): Promise<ProjectSummary[]> {
  const state = contextProjectErrors()
  const [own, elsewhere] = await Promise.all([contextProjects().list(), contextRemote().elsewhere()])
  const here = own.map(project => {
    const { errors, local } = state(project.path)
    return { ...project, ...(errors.length > 0 ? { errors } : {}), ...(local ? { local } : {}) }
  })
  return [...here, ...elsewhere]
}

/**
 * This computer's own projects, for another computer of the person's that lists them beside its
 * own (elsewhere.ts): each with the address another computer names it by and clones it from, and
 * whether its agents' records are shared. Never the projects this computer lists of others.
 */
export async function onOwnProjects(): Promise<OwnProject[]> {
  return Promise.all(
    (await contextProjects().list()).map(async project => {
      const [address, spelling, share, modules] = await Promise.all([
        repositoryAddress(project.path),
        repositorySpelling(project.path),
        readSharing(project.path).catch(() => false),
        readProjectPages(project.path).catch(() => []),
      ])
      return {
        id: project.id,
        name: project.name,
        path: project.path,
        ...(address !== undefined ? { address } : {}),
        ...(spelling !== undefined ? { spelling } : {}),
        share,
        gitHost: project.gitHost,
        activated: project.activated,
        ...(project.lastActivityAt !== undefined ? { lastActivityAt: project.lastActivityAt } : {}),
        modules: modules.map(module => module.package),
      }
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

/** What the launcher offers for a project: its commands, and whether a run can be started here at all. */
export interface ProjectLauncher {
  commands: ProjectCommand[]
  /** Whether the project's `.openagent/hooks.yml` has a `start` line; without one Start is off. */
  startHook: boolean
  /** Whether one of the project's packages provides a git host; without one no pull request can be opened, so the publish menu stops at the branch. */
  gitHost: boolean
  /** Whether the project's repository has an `origin` remote; without one nothing can be published, so the publish menu stops at the commit. */
  remote: boolean
  /** The address the project's repository was cloned from, the name another machine knows the project by; absent, the project cannot be sent to one. */
  address?: string
  /**
   * What the launcher's branch menu always lists: `main`, the name of origin's default branch, and
   * `local`, the branch the project's folder is on now. Absent where a pick could not be obeyed:
   * the start line does not pass `BASE` on, the repository has no remote, or the folder is on no
   * branch. The rest of the menu is {@link onStartBranches}.
   */
  startFrom?: { main: string; local: string }
  /** Whether the start line passes `PR_BASE` on: without it the launcher offers no branch for the pull request to go into. */
  prBase: boolean
}

/**
 * The project's commands (#1774), read off its skills folders, whether it has a start hook, whether
 * it has a git host, and the branches an agent can start from. `from` is the person's pick of those
 * branches: a command is waiting for the branch agents will start from. `null` when the project is
 * unknown here.
 */
export async function onCommands(projectId: string, from?: StartFromPick): Promise<ProjectLauncher | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const [commands, hooks, gitHost, remote, address, main, local] = await Promise.all([readProjectCommands(cwd), readProjectHooks(cwd), projectGitHost(cwd).catch(() => undefined), hasRemote(cwd), repositoryAddress(cwd), originDefaultBranch(cwd), currentBranch(cwd)])
  // Both read locally, never fetched. `HEAD` is a folder on no branch: there is no local branch to start from.
  const startFrom = hooks.start !== undefined && startLineTakesBase(hooks.start) && remote && main !== undefined && local !== undefined && local !== 'HEAD' ? { main: main.slice('origin/'.length), local } : undefined
  // A skill written into the folder reaches agents once it is on the branch they start from: until then its command is said to be waiting.
  const pick = startFrom ? startFromPick(from) : undefined
  const { waiting } = await waitingSkills(cwd, commands.map(command => command.name), pick)
  const listed = commands.map(command => {
    const waits = waiting.get(command.name)
    return waits ? { ...command, waiting: waits.branch } : command
  })
  return { commands: listed, startHook: hooks.start !== undefined, gitHost: gitHost !== undefined, remote, prBase: hooks.start !== undefined && startLineTakesPrBase(hooks.start), ...(address ? { address } : {}), ...(startFrom ? { startFrom } : {}) }
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

/**
 * What would stop a run in this project before it spends a checkout, said in the launcher before
 * the Start: the project's `check` hook, given the coding agent picked. A missing CLI or a
 * logged-out one is a problem the run itself would refuse on; a warning is said and blocks nothing.
 * A check line that fails is said as a warning: it is a broken check, not a reason to stop.
 * `null` for an unknown project or one without a check hook: nothing to say.
 */
export async function onStartCheck(projectId: string, driver?: string): Promise<StartReadiness | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  // The launcher asks this as it opens and at each change of agent: a Start is near, on this agent.
  contextPrepareStart()(projectId, typeof driver === 'string' ? driver : undefined)
  const checked = await runCheckHook(cwd, driver !== undefined ? { driver } : {})
  if (checked.ok) return { problems: checked.problems, warnings: checked.warnings, ...(checked.fix ? { fix: checked.fix } : {}) }
  return checked.noHook ? null : { problems: [], warnings: [checked.error] }
}

/**
 * What would stop a run of a project this computer clones first, asked before it does: its coding
 * agent, installed and logged in, and whether its logins read the repository at the address. A
 * computer that does not have the project yet has no check hook of it to run. `as` is what the
 * asker calls this computer, so the words read right on its page.
 */
export async function onCloneCheck(address: string, driver?: string, as?: string): Promise<StartReadiness> {
  const ready = await loginsWiring.ready(typeof driver === 'string' && isDriverName(driver) ? driver : 'claude-code')
  const typed = typeof address === 'string' ? address : ''
  const account = await cloneAccountFor(typed)
  const read = await canRead(typed, account ? { account } : {}, typeof as === 'string' && as.trim() ? as.trim() : undefined)
  return { problems: [...ready.problems, ...(read.ok ? [] : [read.error])], warnings: ready.warnings, ...(ready.fix ? { fix: ready.fix } : {}) }
}


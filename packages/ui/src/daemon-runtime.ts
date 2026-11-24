import { isAbsolute, join, resolve, sep } from 'node:path'
import { hostname } from 'node:os'
import { stat } from 'node:fs/promises'
import { hasImage, isImageName } from '@openagt/agent-driver'
import { IMAGES_PER_MESSAGE } from './images.js'
import { MODULE_NAME, type Hooks, type ProjectRef, type RunHost, type RunOptions } from '@openagt/hooks'
import { sessionRepos } from '@openagt/git-branches'
import { findCheckout, isPidAlive, projectBranches, readLiveMetas } from './store/index.js'
import { OPENAGENT_DIR } from './openagent-dir.js'
import type { StartAgentOptions, StartAgentResult, AddProjectResult, RemoveProjectResult, StartedInResult } from './dashboard/types.js'
import { ownRunsWatch } from './dashboard/runs-watch.js'
import { screenInDiary } from './dashboard/screen.js'
import { addProject, listProjects, removeProject } from './registry.js'
import { errorMessage, fileBranchRepo, installProject, projectKey, sessionsHome, writeSharing, projectId } from '@openagt/agent-data'
import { publishedBranch } from '@openagt/agent-data/names'
import { branchesOnOrigin } from './dashboard/start-branch.js'
import { removeProjectFiles } from './remove-files.js'
import { projectRefAt } from './distribution-hooks.js'
import { isPublishPick, publishLevelOf, publishPickIn } from './publish-levels.js'
import { isBranchName } from './branch-name.js'
import { hasRemote } from './has-remote.js'
import { projectGitHost } from './store/git-host.js'
import { providedDataChanged } from './store/provided.js'
import { projectAddresses, SESSIONS_ID } from './project-address.js'
import { readySessionsHome } from './sessions-home.js'

/**
 * What the daemon does for a project (#393): start a run, add, find and remove a project. Split
 * from daemon.ts so that file reads as the daemon's lifecycle (ports, boot, shutdown). The daemon
 * runs no agent itself: a Start here goes to this computer's host (`run.host`, #2394), the module
 * of the distribution that gives it, and the run belongs to that module: it names the run, and
 * puts it on the picks made for every next run where the Start's options name none.
 */

/**
 * Why a Start's picks are refused before anything is asked of the project, or nothing: only what
 * reads as the thing it names goes on to the host.
 */
function refusedPicks(options: StartAgentOptions, noProject: boolean): string | undefined {
  if (options.options !== undefined && !isRunOptions(options.options)) return 'The run options are one object per module.'
  // A session with no project: with no branch; the repos it has are copied into its folder, and are
  // what it publishes. Its git host account goes with it: it may reach the host all the same.
  if (noProject && (options.base !== undefined || options.prBase !== undefined)) return 'A session with no project runs with no branch.'
  if (noProject && options.publish !== undefined && !(Array.isArray(options.repos) && options.repos.length > 0)) return 'A session with no project and no repo has nothing to publish.'
  if (options.images !== undefined && !(Array.isArray(options.images) && options.images.length <= IMAGES_PER_MESSAGE && options.images.every(isImageName))) return 'Images are named by the names the dashboard kept them under.'
  // Another host runs a project's run, on a machine of its own.
  if (options.host !== undefined && (typeof options.host !== 'string' || !MODULE_NAME.test(options.host))) return 'A host is named by its id.'
  if (noProject && options.host !== undefined) return 'A session with no project runs on this computer.'
  // A login is one word.
  if (options.account !== undefined && !(typeof options.account === 'string' && /^\S+$/.test(options.account))) return 'An account is named by its login.'
  // A repo is a whole path, and the run's process is handed them one per line.
  if (options.repos !== undefined && !(Array.isArray(options.repos) && options.repos.every(folder => typeof folder === 'string' && isAbsolute(folder) && !folder.includes('\n')))) {
    return 'A repo is named by the path of its folder on this computer.'
  }
  return undefined
}

/** Inputs to {@link createProjectRuntime}. */
export interface ProjectRuntimeOptions {
  /** The daemon's home workspace; a run with no project id targets it. */
  cwd: string
  /** Env for the registry lookups (#393). */
  env: NodeJS.ProcessEnv
  /** This computer's host, the distribution's (`distribution-hooks.ts`): where a run started here runs. */
  host: RunHost
  /** The hosts beside this computer's of the modules on in a project, where a run may be picked to run (`options.host`); none when unsaid. */
  otherHosts?: (project?: ProjectRef) => Promise<RunHost[]>
  /** Who is told of a project added or removed: the distribution's modules (`app.lifecycle`). */
  lifecycle?: Pick<Hooks, 'projectAdded' | 'projectRemoved'>
}

/** The per-project surface the dashboard drives, plus its teardown. */
export interface ProjectRuntime {
  onStart: (prompt: string, options?: StartAgentOptions, targetProjectId?: string) => Promise<StartAgentResult>
  onAddProject: (path: string, share?: boolean) => Promise<AddProjectResult>
  /**
   * The folder `openagent` was started in: the listed project that holds it, so starting again
   * inside a project, or inside one of its folders, adds nothing; else the folder, added as Add
   * project adds one, with no answer on the agents' records: the repository keeps the one it has. Asked in-process by the daemon that starts there, and over RPC (`sendStartedAgain`) by
   * a second `openagent` that finds the dashboard running already.
   */
  onStartedIn: (folder: string) => Promise<StartedInResult>
  onRemoveProject: (projectId: string, files?: boolean) => Promise<RemoveProjectResult>
  /** Where the live screen of a run on this computer answers, as its diary names it; nothing when
   *  the run has none: it opened no screen, closed it, or ended. */
  screenOf: (projectId: string, agentId: string) => Promise<string | undefined>
}

/**
 * The daemon's per-project runtime (#393). The home `cwd` is the default target: a request with
 * no project id (or the home id) resolves to it without a registry lookup.
 */
export function createProjectRuntime({ cwd, env, host, otherHosts = async () => [], lifecycle }: ProjectRuntimeOptions): ProjectRuntime {
  const homeId = projectId(resolve(cwd))

  // A project id resolves to its repo path via the registry; the home id (or none)
  // resolves to the daemon's own `cwd` without a lookup.
  const resolveProject = async (id: string | undefined): Promise<string | undefined> => {
    if (!id || id === homeId) return cwd
    if (id === SESSIONS_ID) return sessionsHome(env)
    const records = await listProjects(env)
    return records.find(record => record.id === id)?.path
  }

  // Start: this computer's host, which answers the id of the run it began. The daemon holds nothing
  // about the run: no slot, no cap (a person's click is the brake), no process to stop at shutdown.
  const onStart = async (prompt: string, options: StartAgentOptions = {}, targetProjectId?: string): Promise<StartAgentResult> => {
    // A session with no project runs in a folder of its own in the sessions home, on this computer.
    const noProject = targetProjectId === SESSIONS_ID
    const refused = refusedPicks(options, noProject)
    if (refused !== undefined) return { ok: false, error: refused }
    const projectCwd = noProject ? await readySessionsHome(sessionsHome(env)) : await resolveProject(targetProjectId)
    if (!projectCwd) return { ok: false, error: `unknown project: ${targetProjectId}` }
    // The branch to start from ends up on the run's command line: only a branch name goes there.
    // Refused, not dropped: a run started from the main branch instead would be a silent swap.
    if (options.base !== undefined && !isBranchName(options.base)) return { ok: false, error: `not a branch name: ${String(options.base)}` }
    if (options.prBase !== undefined && !isBranchName(options.prBase)) return { ok: false, error: `not a branch name: ${String(options.prBase)}` }
    // A branch picked off origin's list may have gone since. Asked of origin here, so the person is
    // told above the box, rather than by a run that fails to make its checkout.
    const published = options.base !== undefined ? publishedBranch(options.base) : undefined
    if (published !== undefined) {
      const onOrigin = await branchesOnOrigin(projectCwd)
      if (!onOrigin) return { ok: false, error: `Could not read the branch ${published} from origin. Check the connection, or pick another branch to start from.` }
      if (!onOrigin.includes(published)) return { ok: false, error: `The branch ${published} is no longer on origin. Pick another branch to start from.` }
    }
    // The pick in force is decided here, so every Start goes the same way whichever page sent it:
    // with none saved the run commits and pushes nothing, and with one the project is not offered
    // it goes as far as the project does with no pull request: its branch pushed, or its work
    // committed where there is no remote.
    // With no project the level is for the session's copies of repos, whatever host each is on: the pick as sent, and none with no repo.
    const publish = noProject
      ? options.publish !== undefined && isPublishPick(options.publish) ? publishLevelOf(options.publish) : undefined
      : publishLevelOf(publishPickIn(options.publish, (await projectGitHost(projectCwd).catch(() => undefined)) !== undefined, await hasRemote(projectCwd)))
    // A session's repos, each under the name it has in the session's folder: one that is no repository refuses the Start.
    const repos = options.repos !== undefined ? await sessionRepos(options.repos).then(given => ({ given }), (err: unknown) => ({ error: errorMessage(err) })) : undefined
    if (repos && 'error' in repos) return { ok: false, error: repos.error }
    const project = noProject ? undefined : await projectRefAt(targetProjectId ?? homeId, projectCwd)
    // The host picked to run it, among the project's: one no module on in the project has refuses the Start.
    const runsOn = options.host === undefined || options.host === host.id ? host : (await otherHosts(project)).find(other => other.id === options.host)
    if (!runsOn) return { ok: false, error: `No host ${String(options.host)} is on in this project. Pick another place to run.` }
    // The images stay on this computer, and so does a run that looks at them.
    const images = options.images ?? []
    if (images.length > 0 && runsOn !== host) return { ok: false, error: `Images stay on this computer: a session with images runs here, not on ${runsOn.label}.` }
    if (!(await Promise.all(images.map(name => hasImage(name, env)))).every(Boolean)) return { ok: false, error: 'An image is no longer on this computer. Take it out and add it again.' }
    const started = await runsOn
      .start({
        ...(project ? { project } : {}),
        prompt,
        ...(images.length > 0 ? { images } : {}),
        // A run of another host's says which: its options and its record name it.
        options: { ...(runsOn !== host ? { host: runsOn.id } : {}), ...runOptionsOf(options, publish, repos?.given) },
      })
      .then(({ id }) => ({ ok: true as const, id }), (err: unknown) => ({ ok: false as const, error: errorMessage(err) }))
    // The host made a checkout (or is about to): the project's checkouts are read again on the
    // next look rather than a few seconds from now, so the new run's page finds its own.
    if (started.ok) {
      projectBranches.changed(projectCwd)
      ownRunsWatch.poke(projectCwd)
    }
    return started.ok ? { ok: true, agentId: started.id } : { ok: false, error: started.error }
  }

  // Add a project (#396): install the repo, then register it so it appears in the Projects
  // list. installProject is idempotent (an already-activated repo is a no-op success). `share`
  // is the person's answer on the agents' records, written before the project is registered:
  // the first sync of a project added with `false` sends nothing. No answer leaves the
  // repository's own as it is: one never asked reads as kept, and a yes given before stays a yes.
  const onAddProject = async (path: string, share?: boolean): Promise<AddProjectResult> => {
    // Resolve relative input against the daemon cwd, and check the directory really
    // exists first: without this a bad path reaches git as a missing cwd, which
    // surfaces as the confusing "spawn git ENOENT" rather than a path error.
    const abs = resolve(path)
    const isDir = await stat(abs).then(s => s.isDirectory()).catch(() => false)
    if (!isDir) return { ok: false, error: `path does not exist or is not a directory: ${abs}` }
    const result = await installProject(abs)
    if (!result.ok) return { ok: false, error: result.error }
    // A yes is to the remote that is there: with none the records are kept, so a remote the
    // project gets later is asked about, in the project's menu, before anything goes to it.
    const shared = share === true && (await hasRemote(abs))
    if (share !== undefined) {
      const written = await writeSharing(abs, shared).then(() => undefined, (err: unknown) => (err instanceof Error ? err.message : String(err)))
      if (written !== undefined) return { ok: false, error: written }
    }
    const at = new Date().toISOString()
    const listed = await addProject(abs, at, env).catch(() => undefined)
    // Put on the list by this add: the modules on in it start their work there, its scheduler
    // where scheduled-agents is on. One on the list already has had it started.
    if (listed?.addedAt === at) await lifecycle?.projectAdded(await projectRefAt(listed.id, abs))
    return { ok: true, alreadyActivated: result.alreadyActivated === true, ...(share && !shared ? { noRemote: true as const } : {}) }
  }

  const onStartedIn = async (folder: string): Promise<StartedInResult> => {
    const path = resolve(folder)
    const holding = (await listProjects(env)).find(project => path === project.path || path.startsWith(project.path + sep))
    if (!holding) {
      const added = await onAddProject(path)
      if (!added.ok) return added
    }
    const id = holding?.id ?? projectId(path)
    // The address the page writes: by the projects it lists, those whose folder is there, in the
    // registry's order. A module's page words are the browser's alone, so a folder named as one
    // (`logs`) is printed by its name where the page shows its id; both open it.
    const listed = await listProjects(env)
    const present = await Promise.all(listed.map(async project => ((await stat(project.path).then(s => s.isDirectory(), () => false)) ? [project.id] : [])))
    return { ok: true, id, path: holding?.path ?? path, added: !holding, address: projectAddresses(present.flat(), []).addressOf(id) }
  }

  // Remove a project: it leaves the Projects list and nothing in its folder is deleted. Found in
  // the list by its id and not through its folder, so a project whose folder is gone goes too.
  const onRemoveProject = async (id: string, files = false): Promise<RemoveProjectResult> => {
    const listed = await listProjects(env)
    const record = listed.find(project => project.id === id)
    if (!record) return { ok: false, error: 'no project with that id is on the list' }
    const here = await stat(record.path).then(s => s.isDirectory()).catch(() => false)
    if (here) {
      // The checkouts are read fresh: a run started a moment ago must be seen.
      projectBranches.changed(record.path)
      // An agent at work would go on working in a project the dashboard no longer shows. A card
      // left "running" by a process that died does not count: nothing is working there.
      const working = (await readLiveMetas(record.path).catch(() => [])).some(
        agent => agent.status === 'running' && agent.pid !== undefined && agent.host === hostname() && isPidAlive(agent.pid),
      )
      if (working) return { ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' }
    }
    await removeProject(id, env)
    providedDataChanged(record.path)
    // Every module is told, so what it started there stops: off the list, nothing else would stop
    // the project's scheduler.
    await lifecycle?.projectRemoved(await projectRefAt(id, record.path))
    if (!files || !here) return { ok: true }
    // Off the list first, so no background job of this daemon starts on the folder again; then
    // what OpenAgent left in it. The records are the repository's: while another project on the
    // list is a checkout of the same repository, or a clone of it whose records the personal
    // folder keeps in the same directory, they stay.
    const repository = await fileBranchRepo(record.path)
    const key = await projectKey(repository ?? record.path)
    let recordsUsedBy: string | undefined
    for (const other of listed) {
      if (other.id === id) continue
      const otherRepository = await fileBranchRepo(other.path)
      if ((repository !== undefined && otherRepository === repository) || (await projectKey(otherRepository ?? other.path)) === key) recordsUsedBy = other.path
    }
    const cleanup = await removeProjectFiles(record.path, { recordsUsedBy })
    providedDataChanged(record.path)
    return { ok: true, cleanup }
  }

  // A screen lives while its run has a checkout: a finished run's diary names none that answers,
  // so it is not read. Asked of the shared list only: a tab open on a run asks every few seconds.
  const screenOf = async (project: string, agentId: string): Promise<string | undefined> => {
    const projectCwd = await resolveProject(project)
    const checkout = projectCwd ? await findCheckout(projectCwd, agentId, projectBranches, { cached: true }) : undefined
    return checkout ? screenInDiary(join(checkout.path, OPENAGENT_DIR, `${agentId}.jsonl`)) : undefined
  }

  return { onStart, onAddProject, onStartedIn, onRemoveProject, screenOf }
}

/** A Start's picks as the run's options: one slice per module that acts on them (#2394). */
/**
 * Whether `value` reads as run options: an object of the modules' slices, each an object, beside
 * the two picks every run has (where it runs, how far it takes its work), each a word. What a
 * slice holds is its module's to check: its steps refuse what they do not take.
 */
export function isRunOptions(value: unknown): value is RunOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(([key, slice]) =>
    key === 'host' || key === 'publish' ? typeof slice === 'string' : MODULE_NAME.test(key) && typeof slice === 'object' && slice !== null && !Array.isArray(slice),
  )
}

/** The picks a Start's controls made (`options`) over the ones it names flat, slice by slice. */
function withPicked(flat: RunOptions, picked: RunOptions | undefined): RunOptions {
  if (picked === undefined) return flat
  const merged: Record<string, unknown> = { ...flat }
  for (const [key, slice] of Object.entries(picked)) {
    const was = merged[key]
    merged[key] = typeof slice === 'object' && typeof was === 'object' && was !== null ? { ...was, ...slice } : slice
  }
  return merged as RunOptions
}

function runOptionsOf(options: StartAgentOptions, publish: RunOptions['publish'], repos: { name: string; from: string }[] | undefined): RunOptions {
  return withPicked(flatOptionsOf(options, publish, repos), options.options)
}

function flatOptionsOf(options: StartAgentOptions, publish: RunOptions['publish'], repos: { name: string; from: string }[] | undefined): RunOptions {
  const branches = { ...(options.base !== undefined ? { base: options.base } : {}), ...(repos !== undefined && repos.length > 0 ? { repos } : {}) }
  const github = { ...(options.prBase !== undefined ? { prBase: options.prBase } : {}), ...(options.account !== undefined ? { account: options.account } : {}) }
  return {
    ...(publish !== undefined ? { publish } : {}),
    ...(Object.keys(branches).length > 0 ? { 'git-branches': branches } : {}),
    ...(Object.keys(github).length > 0 ? { github } : {}),
  }
}

import { isAbsolute, join, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { hasImage, isImageName, type ReadyNaming } from '@openagt/agent-driver'
import { IMAGES_PER_MESSAGE } from './images.js'
import { isDriverName } from './driver-names.js'
import { isProfileId, MODULE_NAME, type Hooks, type ProjectRef, type RunHost, type RunOptions, type RunRequest } from '@openagt/hooks'
import { sessionRepos } from '@openagt/git-branches'
import { nameStarted } from './started-names.js'
import { findCheckout, projectBranches } from './store/index.js'
import { OPENAGENT_DIR } from './openagent-dir.js'
import type { StartAgentOptions, StartAgentResult, StartedInResult } from './dashboard/types.js'
import { ownRunsWatch } from './dashboard/runs-watch.js'
import { screenInDiary } from './dashboard/screen.js'
import { readPreferences } from './registry.js'
import { errorMessage, sessionsHome, isSkillName, projectId } from '@openagt/agent-data'
import { publishedBranch } from '@openagt/agent-data/names'
import { branchesOnOrigin } from './dashboard/start-branch.js'
import { listProjects, projectRefAt } from './distribution-hooks.js'
import { isPublishPick, publishLevelOf, publishPickIn } from './publish-levels.js'
import { isBranchName } from './branch-name.js'
import { hasRemote } from './has-remote.js'
import { projectGitHost } from './store/git-host.js'
import { projectAddresses, SESSIONS_ID } from './project-address.js'
import { readySessionsHome } from './sessions-home.js'

/**
 * What the daemon does for a project (#393): start a run, and find the project the folder
 * `openagent` was typed in is. Split from daemon.ts so that file reads as the daemon's lifecycle
 * (ports, boot, shutdown). The daemon runs no agent itself: a Start here goes to this computer's
 * host (`run.host`, #2394), the module of the distribution that gives it, and the run belongs to
 * that module. Adding and removing a project is the projects module's.
 */

/** The coding agent a Start goes to when none was picked: this computer's host's own default (agent-driver's). */
const DEFAULT_DRIVER = 'claude-code'

/** A run's name as it is asked while the run starts: what the host is given of it, and what follows once it answered. */
interface StartName {
  /** The name being asked, or `false` when runs are not named: the person's setting. */
  title: Pick<RunRequest, 'title'>
  /** The host started the run: the name, once in, is shown for it. */
  started: (agentId: string) => void
  /** The host started nothing: the name is not asked for any more. */
  failed: () => void
}

/**
 * Why a Start's picks are refused before anything is asked of the project, or nothing: only what
 * reads as the thing it names goes on to the host.
 */
function refusedPicks(options: StartAgentOptions, noProject: boolean): string | undefined {
  if (options.options !== undefined && !isRunOptions(options.options)) return 'The run options are one object per module.'
  // A session with no project: with no branch; the repos it has are copied into its folder, and are
  // what it publishes. Its git host account goes with it: it may reach the host all the same.
  if (noProject && (options.base !== undefined || options.prBase !== undefined || options.projectSkills !== undefined)) {
    return 'A session with no project runs with no branch and no project skills.'
  }
  if (noProject && options.publish !== undefined && !(Array.isArray(options.repos) && options.repos.length > 0)) return 'A session with no project and no repo has nothing to publish.'
  if (options.images !== undefined && !(Array.isArray(options.images) && options.images.length <= IMAGES_PER_MESSAGE && options.images.every(isImageName))) return 'Images are named by the names the dashboard kept them under.'
  // Another host runs a project's run, on a machine of its own.
  if (options.host !== undefined && (typeof options.host !== 'string' || !MODULE_NAME.test(options.host))) return 'A host is named by its id.'
  if (noProject && options.host !== undefined) return 'A session with no project runs on this computer.'
  // A login is one word.
  if (options.account !== undefined && !(typeof options.account === 'string' && /^\S+$/.test(options.account))) return 'An account is named by its login.'
  if (options.profile !== undefined && !isProfileId(options.profile)) return 'A profile is named by its id.'
  // The picks are lists of names.
  const skillList = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(isSkillName)
  if (options.pluginsWithout !== undefined && !(Array.isArray(options.pluginsWithout) && options.pluginsWithout.every(name => typeof name === 'string' && MODULE_NAME.test(name)))) return 'Plugins are named by their names.'
  if (options.projectSkills !== undefined && options.projectSkills !== 'all' && options.projectSkills !== 'none' && !skillList(options.projectSkills)) return 'Project skills are all, none, or named by their names.'
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
  /** The naming sessions kept waiting for runs started here; without, each run asks for its own name. */
  naming?: ReadyNaming
  /** This computer's host, the distribution's (`distribution-hooks.ts`): where a run started here runs. */
  host: RunHost
  /** The hosts beside this computer's of the modules on in a project, where a run may be picked to run (`options.host`); none when unsaid. */
  otherHosts?: (project?: ProjectRef) => Promise<RunHost[]>
  /** What makes the folder `openagent` was typed in a project: the distribution's modules (`app.lifecycle`). */
  folderGiven?: Hooks['folderGiven']
}

/** The per-project surface the dashboard drives, plus its teardown. */
export interface ProjectRuntime {
  onStart: (prompt: string, options?: StartAgentOptions, targetProjectId?: string) => Promise<StartAgentResult>
  /**
   * The folder `openagent` was started in, made a project by the modules (`folderGiven`, the
   * projects module's): the listed project that holds it, or the repository it is in, added; none
   * outside a repository. Asked in-process by the daemon that starts there, and over RPC
   * (`sendStartedAgain`) by a second `openagent` that finds the dashboard running already.
   */
  onStartedIn: (folder: string) => Promise<StartedInResult | undefined>
  /** A Start is near in a project, on a coding agent: the run's naming session is started for it. */
  onPrepareStart: (projectId: string, driver?: string) => void
  /** Where the live screen of a run on this computer answers, as its diary names it; nothing when
   *  the run has none: it opened no screen, closed it, or ended. */
  screenOf: (projectId: string, agentId: string) => Promise<string | undefined>
  /** Let go of the naming sessions kept waiting. */
  dispose: () => Promise<void>
}

/**
 * The daemon's per-project runtime (#393). The home `cwd` is the default target: a request with
 * no project id (or the home id) resolves to it without a registry lookup.
 */
export function createProjectRuntime({ cwd, env, naming, host, otherHosts = async () => [], folderGiven = async () => undefined }: ProjectRuntimeOptions): ProjectRuntime {
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
    const driver = options.driver ?? DEFAULT_DRIVER
    const project = noProject ? undefined : await projectRefAt(targetProjectId ?? homeId, projectCwd)
    // The host picked to run it, among the project's: one no module on in the project has refuses the Start.
    const runsOn = options.host === undefined || options.host === host.id ? host : (await otherHosts(project)).find(other => other.id === options.host)
    if (!runsOn) return { ok: false, error: `No host ${String(options.host)} is on in this project. Pick another place to run.` }
    // The images stay on this computer, and so does a run that looks at them.
    const images = options.images ?? []
    if (images.length > 0 && runsOn !== host) return { ok: false, error: `Images stay on this computer: a session with images runs here, not on ${runsOn.label}.` }
    if (!(await Promise.all(images.map(name => hasImage(name, env)))).every(Boolean)) return { ok: false, error: 'An image is no longer on this computer. Take it out and add it again.' }
    const name = await nameAsStarted(projectCwd, prompt, driver)
    const started = await runsOn
      .start({
        ...(project ? { project } : {}),
        prompt,
        ...(images.length > 0 ? { images } : {}),
        // A run of another host's says which: its options and its record name it.
        options: { ...(runsOn !== host ? { host: runsOn.id } : {}), ...runOptionsOf(options, publish, repos?.given) },
        ...name.title,
      })
      .then(({ id }) => ({ ok: true as const, id }), (err: unknown) => ({ ok: false as const, error: errorMessage(err) }))
    // The host made a checkout (or is about to): the project's checkouts are read again on the
    // next look rather than a few seconds from now, so the new run's page finds its own.
    if (started.ok) {
      projectBranches.changed(projectCwd)
      ownRunsWatch.poke(projectCwd)
      name.started(started.id)
    } else name.failed()
    return started.ok ? { ok: true, agentId: started.id, driver } : { ok: false, error: started.error }
  }

  // The run's name, asked as the run is started rather than once its process is up: of a naming
  // session waiting for this project's runs, it is in about a second after Start. The run is
  // handed a file to find it in, and the page asks for it here (`started-names.ts`). Named unless
  // the person turned naming off: read here rather than sent from the page, so a run a schedule
  // starts is named exactly as one a person starts is.
  const nameAsStarted = async (projectCwd: string, prompt: string, driver: string): Promise<StartName> => {
    const nameRun = (await readPreferences(env)).nameRuns !== false
    if (naming === undefined || !nameRun || !isDriverName(driver) || !naming.names(prompt)) return { title: nameRun ? {} : { title: false }, started: () => {}, failed: () => {} }
    const stop = new AbortController()
    const name = naming.name(projectCwd, prompt, driver, stop.signal)
    return {
      title: { title: name },
      started: id => {
        nameStarted(id, name)
        void name.then(() => ownRunsWatch.poke(projectCwd))
      },
      failed: () => stop.abort(),
    }
  }

  const onStartedIn = async (folder: string): Promise<StartedInResult | undefined> => {
    const given = await folderGiven(resolve(folder)).then(
      found => found,
      (err: unknown) => ({ error: errorMessage(err) }),
    )
    if (given === undefined) return undefined
    if ('error' in given) return { ok: false, error: given.error }
    // The address the page writes: by the projects it lists, those whose folder is there, in the
    // registry's order. A module's page words are the browser's alone, so a folder named as one
    // (`logs`) is printed by its name where the page shows its id; both open it.
    const listed = await listProjects(env)
    const present = await Promise.all(listed.map(async project => ((await stat(project.path).then(s => s.isDirectory(), () => false)) ? [project.id] : [])))
    const { project, added } = given
    return { ok: true, id: project.id, path: project.dir, added, address: projectAddresses(present.flat(), []).addressOf(project.id) }
  }

  // A screen lives while its run has a checkout: a finished run's diary names none that answers,
  // so it is not read. Asked of the shared list only: a tab open on a run asks every few seconds.
  const screenOf = async (project: string, agentId: string): Promise<string | undefined> => {
    const projectCwd = await resolveProject(project)
    const checkout = projectCwd ? await findCheckout(projectCwd, agentId, projectBranches, { cached: true }) : undefined
    return checkout ? screenInDiary(join(checkout.path, OPENAGENT_DIR, `${agentId}.jsonl`)) : undefined
  }

  // A Start is near: the launcher opened, or its agent changed. The naming session that run will
  // take is started now, while the person types, unless one already waits.
  const onPrepareStart = (targetProjectId: string, driver?: string): void => {
    if (naming === undefined) return
    const picked = driver ?? DEFAULT_DRIVER
    if (!isDriverName(picked)) return
    void (async () => {
      if ((await readPreferences(env)).nameRuns === false) return
      const projectCwd = await resolveProject(targetProjectId)
      if (projectCwd) await naming.prepare(projectCwd, picked)
    })()
  }

  const dispose = async (): Promise<void> => {
    await naming?.close()
  }

  return { onStart, onStartedIn, onPrepareStart, screenOf, dispose }
}

/** A Start's picks as the run's options: one slice per module that acts on them (#2394). */
/**
 * Whether `value` reads as run options: an object of the modules' slices, each an object, beside
 * the two picks every run has (where it runs, how far it takes its work), each a word. What a
 * slice holds is its module's to check: its steps refuse what they do not take.
 */
function isRunOptions(value: unknown): value is RunOptions {
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
  const agentDriver = {
    ...(options.driver !== undefined ? { driver: options.driver } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
  }
  const branches = { ...(options.base !== undefined ? { base: options.base } : {}), ...(repos !== undefined && repos.length > 0 ? { repos } : {}) }
  const github = { ...(options.prBase !== undefined ? { prBase: options.prBase } : {}), ...(options.account !== undefined ? { account: options.account } : {}) }
  return {
    ...(Object.keys(agentDriver).length > 0 ? { 'agent-driver': agentDriver } : {}),
    ...(publish !== undefined ? { publish } : {}),
    ...(Object.keys(branches).length > 0 ? { 'git-branches': branches } : {}),
    ...(Object.keys(github).length > 0 ? { github } : {}),
    ...(options.projectSkills !== undefined ? { skills: { project: options.projectSkills } } : {}),
    ...(options.pluginsWithout !== undefined ? { plugins: { without: options.pluginsWithout } } : {}),
    ...(options.profile !== undefined ? { profiles: { profile: options.profile } } : {}),
  }
}

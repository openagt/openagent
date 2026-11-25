import { basename, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { MODULE_NAME, type Hooks, type ProjectRef, type RunHost, type RunOptions } from '@openagt/hooks'
import { readRunEvents } from './store/index.js'
import type { StartAgentOptions, StartAgentResult, StartedInResult } from './dashboard/types.js'
import { ownRunsWatch } from './dashboard/runs-watch.js'
import { liveScreen } from './screens.js'
import { errorMessage, sessionsHome, projectId } from '@openagt/agent-data'
import { listProjects, projectRefAt } from './distribution-hooks.js'
import { isPublishPick, publishLevelOf } from './publish-levels.js'
import { projectAddresses, SESSIONS_ID } from './project-address.js'
import { readySessionsHome } from './sessions-home.js'

/**
 * What the daemon does for a project (#393): start a run, and find the project the folder
 * `openagent` was typed in is. Split from daemon.ts so that file reads as the daemon's lifecycle
 * (ports, boot, shutdown). The daemon runs no agent itself: a Start here goes to this computer's
 * host (`run.host`, #2394), the module of the distribution that gives it, and the run belongs to
 * that module: it names the run, and puts it on the picks made for every next run where the
 * Start's options name none. Adding and removing a project is the projects module's.
 */

/**
 * Why a Start's picks are refused before anything is asked of the project, or nothing: only what
 * reads as the thing it names goes on to the host.
 */
function refusedPicks(options: StartAgentOptions, noProject: boolean): string | undefined {
  if (options.options !== undefined && !isRunOptions(options.options)) return 'The run options are one object per module.'
  // Another host runs a project's run, on a machine of its own.
  if (options.host !== undefined && (typeof options.host !== 'string' || !MODULE_NAME.test(options.host))) return 'A host is named by its id.'
  if (noProject && options.host !== undefined) return 'A session with no project runs on this computer.'
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
  /** Where the live screen of a run on this computer answers, as its diary names it; nothing when
   *  the run has none: it opened no screen, closed it, or ended. */
  screenOf: (projectId: string, agentId: string) => Promise<string | undefined>
}

/**
 * The daemon's per-project runtime (#393). The home `cwd` is the default target: a request with
 * no project id (or the home id) resolves to it without a registry lookup.
 */
export function createProjectRuntime({ cwd, env, host, otherHosts = async () => [], folderGiven = async () => undefined }: ProjectRuntimeOptions): ProjectRuntime {
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
    // With none saved, a run in a project commits its work and pushes nothing; how far the project
    // lets a pick go is its host's to say. With no project the level is for the session's copies of
    // repos: the pick as sent, none when there is none.
    const picked = options.publish !== undefined && isPublishPick(options.publish) ? options.publish : undefined
    const publish = noProject ? (picked !== undefined ? publishLevelOf(picked) : undefined) : publishLevelOf(picked ?? 'commit')
    const project = noProject ? undefined : await projectRefAt(targetProjectId ?? homeId, projectCwd)
    // The host picked to run it, among the project's: one no module on in the project has refuses the Start.
    const runsOn = options.host === undefined || options.host === host.id ? host : (await otherHosts(project)).find(other => other.id === options.host)
    if (!runsOn) return { ok: false, error: `No host ${String(options.host)} is on in this project. Pick another place to run.` }
    // The images stay on this computer, and so does a run that looks at them: its host takes them by their names, or refuses them.
    const images = options.images ?? []
    if (images.length > 0 && runsOn !== host) return { ok: false, error: `Images stay on this computer: a session with images runs here, not on ${runsOn.label}.` }
    const started = await runsOn
      .start({
        ...(project ? { project } : {}),
        prompt,
        ...(images.length > 0 ? { images } : {}),
        // A run of another host's says which: its options and its record name it.
        options: { ...(runsOn !== host ? { host: runsOn.id } : {}), ...runOptionsOf(options, publish) },
      })
      .then(({ id }) => ({ ok: true as const, id }), (err: unknown) => ({ ok: false as const, error: errorMessage(err) }))
    // The project's runs are read again now, so the pages that list them show the new one at once.
    if (started.ok) ownRunsWatch.poke(projectCwd)
    return started.ok ? { ok: true, agentId: started.id } : { ok: false, error: started.error }
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

  // A screen is on this computer's loopback, and lives while its run has a checkout: a finished
  // run's events name none that answers, so they are not read. Read off its events as this
  // computer's host says them.
  const screenOf = async (project: string, agentId: string): Promise<string | undefined> => {
    const projectCwd = await resolveProject(project)
    if (!projectCwd) return undefined
    const run = { id: agentId, ...(project === SESSIONS_ID ? {} : { project: { id: project, name: basename(projectCwd), dir: projectCwd } }) }
    if ((await host.find(run).catch(() => undefined))?.checkout === undefined) return undefined
    const events = await readRunEvents(host, run).catch(() => undefined)
    return events ? liveScreen(events) : undefined
  }

  return { onStart, onStartedIn, screenOf }
}

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

/** The picks a Start's controls made (`options`) over the level it was given (`flat`), slice by slice. */
function withPicked(flat: RunOptions, picked: RunOptions | undefined): RunOptions {
  if (picked === undefined) return flat
  const merged: Record<string, unknown> = { ...flat }
  for (const [key, slice] of Object.entries(picked)) {
    const was = merged[key]
    merged[key] = typeof slice === 'object' && typeof was === 'object' && was !== null ? { ...was, ...slice } : slice
  }
  return merged as RunOptions
}

/** A Start's picks as the run's options: one slice per module that acts on them (#2394), with the level the Start decided. */
function runOptionsOf(options: StartAgentOptions, publish: RunOptions['publish']): RunOptions {
  return withPicked(publish !== undefined ? { publish } : {}, options.options)
}

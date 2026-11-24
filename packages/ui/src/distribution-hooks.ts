import { stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { projectNameOf, repositoryAddress } from '@openagt/agent-data'
import { createHooks, DISTRIBUTION_ENV, loadHandedDown, LOCAL_HOST, PROJECTS, type Hooks, type ProjectRecord, type ProjectRef, type RunHost, type RunRef, type Settings } from '@openagt/hooks'
import { SESSIONS_ID } from './project-address.js'
import { isPidAlive, projectBranches, readLiveMetas } from './store/index.js'

/**
 * The modules the dashboard runs (#2394): those of the distribution handed down to its process
 * (`@openagt/dashboard`'s, or a demo's fakes, `e2e/distribution.ts`), each package resolved from
 * the distribution's own install. `ui` has none of its own.
 */
export async function loadHooks(env: NodeJS.ProcessEnv = process.env): Promise<Hooks> {
  const modules = await loadHandedDown(env)
  if (!modules) throw new Error(`the dashboard runs the modules of a distribution, and none was handed to it (${DISTRIBUTION_ENV}): start it with a distribution's openagent command, such as @openagt/dashboard's`)
  return createHooks(modules, { projects: () => listedProjects(env), refusal: agentAtWork })
}

/**
 * Why a project may not be removed now: an agent at work there would go on working in a project
 * the dashboard no longer shows. A card left "running" by a process that died does not count:
 * nothing is working there. The checkouts are read fresh: a run started a moment ago must be seen.
 */
async function agentAtWork(project: ProjectRef): Promise<string | undefined> {
  projectBranches.changed(project.dir)
  const working = (await readLiveMetas(project.dir).catch(() => [])).some(agent => agent.status === 'running' && agent.pid !== undefined && agent.host === hostname() && isPidAlive(agent.pid))
  return working ? 'An agent is working in this project. Stop it, then remove the project.' : undefined
}

/** The projects on this computer's list, as the projects module keeps it (`PROJECTS`): read through the distribution's settings. */
export async function listProjects(env: NodeJS.ProcessEnv = process.env): Promise<ProjectRecord[]> {
  return (await distributionSettings(env)).get(PROJECTS)
}

/** The projects on this computer's list whose folder is there, as a module's life is told them: one whose folder is gone has nothing to run in. */
export async function listedProjects(env: NodeJS.ProcessEnv = process.env): Promise<ProjectRef[]> {
  const listed = await listProjects(env)
  const there = await Promise.all(listed.map(async project => ((await stat(project.path).then(s => s.isDirectory(), () => false)) ? [await projectRefAt(project.id, project.path)] : [])))
  return there.flat()
}

/** The hooks this process runs, by the distribution file they were loaded from. */
let loaded: { file: string | undefined; hooks: Promise<Hooks> } | undefined

/**
 * The hooks of the distribution handed down to this process, loaded once for each distribution
 * file: the daemon's, and its calls' (a setting read, a module's function).
 */
export function distributionHooks(env: NodeJS.ProcessEnv = process.env): Promise<Hooks> {
  const file = env[DISTRIBUTION_ENV]
  if (loaded && loaded.file === file) return loaded.hooks
  const hooks = loadHooks(env)
  // A distribution that did not load is tried again at the next call, not kept as its answer.
  hooks.catch(() => {
    if (loaded?.hooks === hooks) loaded = undefined
  })
  loaded = { file, hooks }
  return hooks
}

/** The settings of the distribution handed down to this process: read and saved through its store. */
export async function distributionSettings(env: NodeJS.ProcessEnv = process.env): Promise<Settings> {
  return (await distributionHooks(env)).settings
}

/** This computer's host, agent-driver's: where a run started from here runs. A distribution without it starts no run. */
export async function localHostOf(hooks: Hooks): Promise<RunHost> {
  const host = (await hooks.hosts()).find(one => one.id === LOCAL_HOST)
  if (!host) throw new Error("the dashboard's distribution has no host for this computer, which agent-driver gives")
  return host
}

/** The project at `dir`, as a hook is given it: its name and its repository's address read off its clone. */
export async function projectRefAt(id: string, dir: string): Promise<ProjectRef> {
  const remote = await repositoryAddress(dir)
  return { id, name: await projectNameOf(dir), dir, ...(remote !== undefined ? { remote } : {}) }
}

/** A run of the project `projectId`, at `dir`, as a host is asked about it: a session with no project names none. */
export async function runRefAt(projectId: string, dir: string, id: string): Promise<RunRef> {
  return projectId === SESSIONS_ID ? { id } : { id, project: await projectRefAt(projectId, dir) }
}

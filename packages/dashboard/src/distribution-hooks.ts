import { projectNameOf, repositoryAddress } from '@openagt/agent-data'
import { createHooks, loadHandedDown, loadModules, LOCAL_HOST, type Hooks, type ProjectRef, type RunHost, type RunRef } from '@openagt/hooks'
import DISTRIBUTION from './distribution.js'
import { SESSIONS_ID } from './project-address.js'

/**
 * The modules the dashboard runs (#2394): those of the distribution handed down to its process,
 * when one was (a demo's fakes, `e2e/distribution.ts`), else its own (`distribution.ts`), each
 * package resolved from the dashboard's own dependencies.
 */
export async function loadHooks(env: NodeJS.ProcessEnv = process.env): Promise<Hooks> {
  return createHooks((await loadHandedDown(env)) ?? (await loadModules(DISTRIBUTION, specifier => import(specifier))))
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

import { contextHost, contextOtherHosts, contextProjectState, contextProjects, contextStartedIn, resolveProjectPath } from './context.js'
import { projectRefAt } from '../distribution-hooks.js'
import { errorMessage, repositoryAddress } from '@openagt/agent-data'
import type { StartReadiness } from '../start-readiness.js'
import type { RunOptions } from '@openagt/hooks'
import { isRunOptions } from '../daemon-runtime.js'
import { SESSIONS_ID } from '../project-address.js'
import { hasRemote } from '../has-remote.js'
import { openagentVersion } from '../version.js'
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

/** What the launcher offers for a project: how far its runs can go. */
export interface ProjectLauncher {
  /** Whether the project's repository has an `origin` remote; without one nothing can be published, so the publish menu stops at the commit. */
  remote: boolean
  /** The address the project's repository was cloned from (`git.example.com/acme/shop`): its host is the git host a session pushes to, as the account it picks there. */
  address?: string
}

/** What the launcher offers for a project: whether it has a remote, and its address. `null` when the project is unknown here. */
export async function onCommands(projectId: string): Promise<ProjectLauncher | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const [remote, address] = await Promise.all([hasRemote(cwd), repositoryAddress(cwd)])
  return { remote, ...(address ? { address } : {}) }
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
 * names another, given the launcher's picks for it. A missing CLI or a logged-out one is a problem the
 * run itself would refuse on; a warning is said and blocks nothing. A check that fails is said as a
 * warning: it is a broken check, not a reason to stop. `null` for an unknown project or host, or a
 * host with no check: nothing to say.
 */
export async function onStartCheck(projectId: string, options?: RunOptions, host?: string): Promise<StartReadiness | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const project = projectId === SESSIONS_ID ? undefined : await projectRefAt(projectId, cwd)
  const here = contextHost()
  const checks = typeof host !== 'string' || host === here.id ? here : (await contextOtherHosts(project).catch(() => [])).find(other => other.id === host)
  if (!checks?.check) return null
  try {
    // Asked as the launcher opens and at each change of its picks: a Start is near, on these picks, and the host may ready what that run will want first.
    const picked = isRunOptions(options) ? options : {}
    const checked = await checks.check(project ? { project, options: picked } : { options: picked })
    return { problems: checked.problems, warnings: checked.warnings, ...(checked.fix ? { fix: checked.fix } : {}) }
  } catch (err) {
    return { problems: [], warnings: [errorMessage(err)] }
  }
}



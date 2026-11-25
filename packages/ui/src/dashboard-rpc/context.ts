import { readRun, readRuns, type AgentMeta, type RunHosts } from '../store/index.js'
import { SESSIONS_ID } from '../project-address.js'
import { defaultProjectsProvider, type ProjectsProvider } from '../dashboard/projects.js'
import type { PreferencesStore } from '../registry.js'
import type { OpenAgentUpdates } from '../dashboard/openagent-update.js'
import type { ProjectStateReader } from '../project-state.js'
import type { StartAgentOptions, StartAgentResult, StartedInResult } from '../dashboard/types.js'
import { LOCAL_HOST, type ProjectRef, type RunHost, type RunRef } from '@openagt/hooks'

/** Wired by the daemon so `sendStart` can reach the daemon's own `startAgent` closure. */
export type StartAgentHandler = (
  prompt: string,
  options: StartAgentOptions,
  projectId?: string,
) => StartAgentResult | Promise<StartAgentResult>


/** Wired by the daemon so `sendStartedAgain` can find or add the project a second `openagent` was started in. */
export type StartedInHandler = (folder: string) => StartedInResult | undefined | Promise<StartedInResult | undefined>


/**
 * What every RPC acts through.
 *
 * Every field is required (D3). These used to be optional because three hosts served this same
 * surface — the daemon, a per-session foreground dashboard, and a public relay — each wiring a
 * different subset, so every RPC carried an "absent capability" branch and the client rendered a
 * degradation matrix. There is one host now, and it wires all of it.
 */
export interface DashboardContext {
  startAgent: StartAgentHandler
  startedIn: StartedInHandler
  /** This computer's host (`run.host`, #2394): where a run starts when no other host is picked. */
  host: RunHost
  /**
   * The hosts beside this computer's in a project, of its modules that are on there (`run.host`): a
   * run may be picked to run on one, and a run one of them has is steered, stopped and read there.
   * A session with no project names none.
   */
  otherHosts: (project?: ProjectRef) => Promise<RunHost[]>
  /** The user-preferences store (#410), over the registry file. */
  preferences: PreferencesStore
  /** Whether a newer OpenAgent than the one running here is out. */
  openAgentUpdate: OpenAgentUpdates
  /** What a project's page and row say of it beside its runs (#1500): what needs fixing there, and why its data stays here. */
  projectState: ProjectStateReader
}

/**
 * What the dashboard's RPCs act through: the daemon's own closures, set once when it comes up.
 *
 * A module-level value, not a per-request one. It used to ride Telefunc's request context, read
 * back through `getContext()` inside an AsyncLocalStorage — machinery for a per-caller context
 * that never varied per caller. Two rounds of simplification got it here: three hosts wired
 * different subsets, so every accessor returned `T | undefined` and every RPC branched on the
 * absent case (D3 left one host, which wires all of it); and the request scoping itself was only
 * ever carrying process-wide wiring (F3). What is left is what it always was — the daemon's
 * capabilities, set at boot.
 */
let wired: DashboardContext | undefined

/** Wire the dashboard's capabilities. The daemon calls this once at start-up; a test calls it per case. */
export function setDashboardContext(context: DashboardContext): void {
  wired = context
}

/**
 * Read one capability.
 *
 * Unwired is a bug rather than a degraded host, so it throws and names the field instead of
 * silently answering as if nothing were configured.
 */
function fromContext<K extends keyof DashboardContext>(key: K): DashboardContext[K] {
  const value = wired?.[key]
  if (value === undefined) throw new Error(`the dashboard's RPC context has no ${String(key)}`)
  return value
}

/** The projects every RPC resolves a project id against: the global registry. */
export function contextProjects(): ProjectsProvider {
  return defaultProjectsProvider()
}

/** The workspace path for a project id, or undefined when no project has that id. */
export function resolveProjectPath(projectId: string): Promise<string | undefined> {
  return contextProjects().resolvePath(projectId)
}

/**
 * A project as a host is asked about it, by its id: its name and folder off the list, the sessions
 * with no project none. Undefined for an id no project has.
 */
export async function contextProject(projectId: string): Promise<{ project: ProjectRef | undefined } | undefined> {
  if (projectId === SESSIONS_ID) return { project: undefined }
  const listed = (await contextProjects().list().catch(() => [])).find(project => project.id === projectId)
  return listed ? { project: { id: listed.id, name: listed.name, dir: listed.path } } : undefined
}

/**
 * The checkout a call should act on: a run's own while its host says it has one (#738/#749), else
 * the project's folder. A run reads and writes inside its checkout, so anything addressed at a
 * run resolves here; once the checkout is gone, the project's own state is the sane thing to act on.
 */
export async function resolveAgentPath(projectId: string, agentId?: string): Promise<string | undefined> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !agentId) return cwd
  const at = await contextProject(projectId)
  if (!at) return cwd
  const run: RunRef = { id: agentId, ...(at.project ? { project: at.project } : {}) }
  return (await (await runHostOf(run)).find(run).catch(() => undefined))?.checkout ?? cwd
}

/** Where the shell asks about runs: this computer's host and those beside it in a project. */
export function contextHosts(): RunHosts {
  return { local: LOCAL_HOST, of: async project => [contextHost(), ...(await contextOtherHosts(project).catch((): RunHost[] => []))] }
}

/** A listed project's runs, or with none the sessions with no project, as their hosts say them. */
export function contextRuns(project: { id: string; name: string; path: string } | undefined): Promise<AgentMeta[]> {
  return readRuns(contextHosts(), project ? { id: project.id, name: project.name, dir: project.path } : undefined)
}

/** One run of a project by their ids, as its hosts say it; none for a project not on the list, or a run no host has. */
export async function contextRun(projectId: string, agentId: string): Promise<AgentMeta | undefined> {
  const at = await contextProject(projectId)
  return at ? readRun(contextHosts(), at.project, agentId) : undefined
}

/** This computer's host (`run.host`, #2394): where a run starts when no other host is picked. */
export function contextHost(): RunHost {
  return fromContext('host')
}

/** The hosts a run of `project` may be picked to run on beside this computer's: those of the modules on there. */
export function contextOtherHosts(project?: ProjectRef): Promise<RunHost[]> {
  return fromContext('otherHosts')(project)
}

/**
 * The host `run` is on, where what a person says to it, a Stop and the reads of its work go: the
 * first of its project's other hosts that has it, else this computer's. A host that cannot say is
 * taken to have none of it.
 */
export async function runHostOf(run: RunRef): Promise<RunHost> {
  for (const host of await contextOtherHosts(run.project).catch(() => [])) {
    if (await host.find(run).catch(() => undefined)) return host
  }
  return contextHost()
}

/** The user-preferences store (#410), over the registry file. */
export function contextPreferences(): PreferencesStore {
  return fromContext('preferences')
}

/** Whether a newer OpenAgent than the one running here is out. */
export function contextOpenAgentUpdate(): OpenAgentUpdates {
  return fromContext('openAgentUpdate')
}

/** What a project's page and row say of it beside its runs (#1500). */
export function contextProjectState(): ProjectStateReader {
  return fromContext('projectState')
}


/** The daemon's own `startAgent`, so a start from the dashboard is the same start the CLI makes. */
export function contextStartAgent(): DashboardContext['startAgent'] {
  return fromContext('startAgent')
}

/** Find or add the project a second `openagent` was started in (#2141), which only the daemon can do. */
export function contextStartedIn(): DashboardContext['startedIn'] {
  return fromContext('startedIn')
}


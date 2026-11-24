import { resolveAgentCheckout } from '../store/index.js'
import { defaultProjectsProvider, type ProjectsProvider } from '../dashboard/projects.js'
import type { PreferencesStore } from '../registry.js'
import type { OpenAgentUpdates } from '../dashboard/openagent-update.js'
import type { ProjectStateReader } from '../project-state.js'
import type { AddProjectResult, RemoveProjectResult, StartAgentOptions, StartAgentResult, StartedInResult } from '../dashboard/types.js'
import type { ProjectRef, RunHost, RunRef } from '@openagt/hooks'

/** Wired by the daemon so `sendStart` can reach the daemon's own `startAgent` closure. */
export type StartAgentHandler = (
  prompt: string,
  options: StartAgentOptions,
  projectId?: string,
) => StartAgentResult | Promise<StartAgentResult>

/** Wired by the daemon so `sendAddProject` can install + register a repo (#433). */
export type AddProjectHandler = (path: string, share: boolean) => AddProjectResult | Promise<AddProjectResult>

/** Wired by the daemon so `sendStartedAgain` can find or add the project a second `openagent` was started in. */
export type StartedInHandler = (folder: string) => StartedInResult | Promise<StartedInResult>

/** Wired by the daemon so `sendRemoveProject` can take a project off the list, by its id, and with `files` remove what OpenAgent left in its folder. */
export type RemoveProjectHandler = (projectId: string, files: boolean) => RemoveProjectResult | Promise<RemoveProjectResult>

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
  addProject: AddProjectHandler
  startedIn: StartedInHandler
  removeProject: RemoveProjectHandler
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
 * The checkout a call should act on: a live agent's own worktree when `agentId` names one (#738/#749),
 * else the project root. Since #736 an agent reads and writes inside its worktree — its event log,
 * its control log, its working tree — so anything addressed at a *run* has to resolve here, not
 * at the project path, or it reads an empty log and steers an agent that is not listening. The
 * resolution itself (and its #766 first-seconds subtlety) lives in the store's
 * {@link resolveAgentCheckout}, shared with the daemon; this adds only the project-id lookup.
 */
export async function resolveAgentPath(projectId: string, agentId?: string): Promise<string | undefined> {
  const cwd = await resolveProjectPath(projectId)
  return cwd ? resolveAgentCheckout(cwd, agentId) : undefined
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

/** Install + register a repo (#433), which only the daemon can do. */
export function contextAddProject(): DashboardContext['addProject'] {
  return fromContext('addProject')
}

/** Find or add the project a second `openagent` was started in (#2141), which only the daemon can do. */
export function contextStartedIn(): DashboardContext['startedIn'] {
  return fromContext('startedIn')
}

/** Take a project off the list, which only the daemon can do: it runs the project's close hooks first. */
export function contextRemoveProject(): DashboardContext['removeProject'] {
  return fromContext('removeProject')
}

import { resolveAgentCheckout, type AgentMeta } from '../store/index.js'
import { defaultProjectsProvider, type ProjectsProvider, type ProjectSummary } from '../dashboard/projects.js'
import type { PreferencesStore } from '../registry.js'
import type { QuotaSource } from '../dashboard/quota.js'
import type { ModelsSource } from '../dashboard/models.js'
import type { AgentUpdates } from '../dashboard/agent-updates.js'
import type { ProjectErrorsReader } from '../project-errors.js'
import type { BridgeBrowserOwner } from '../bridge-browser.js'
import type { OpenAgentEvent } from '../events.js'
import type { OwnProject } from '../dashboard/elsewhere.js'
import type { MachinesQueue } from '../dashboard/machine-interventions.js'
import type { AddProjectResult, RemoveProjectResult, StartAgentOptions, StartAgentResult, StartedInResult } from '../dashboard/types.js'
import type { BringProject, RelayProject, RemoteTarget } from '../dashboard/remote-run.js'
import type { MachineRuns } from '../dashboard/machine-runs.js'

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

/** Resolve an agent to its live event stream: the relay feeds `onEvents` from its own in-memory stream
 * rather than a file on disk (#426), and the daemon feeds an agent it is relaying from a machine (#1067).
 * Returns undefined when there is no in-memory stream, so `onEvents` falls back to tailing the log. */
export type EventsSource = (projectId: string, agentId?: string) => AsyncIterable<OpenAgentEvent> | undefined

/** A saved machine as a run's row needs it: the name it was given, and its address. */
export interface SavedMachine {
  label: string
  url: string
  server?: boolean
}

/** Look up the machine a relayed agent (#1067) executes on, or undefined for an ordinary local agent. The
 *  daemon wires this from its live relayed-agent map; a run-scoped RPC uses it to forward a remote agent's
 *  read/steer/handoff to that machine instead of resolving a (nonexistent) local checkout. */
export interface RemoteAgents {
  /** The machine of a run this daemon follows, in the project when one is named: a run's id alone says nothing of its project. */
  target(agentId: string | undefined, projectId?: string): RemoteTarget | undefined
  /** A project's relayed run stubs (#1077), so `onAgents` can show a remote agent in the list and re-open it after a reload. */
  list(projectId: string): AgentMeta[]
  /** Whether a followed run is one this computer sent to its machine. Any other is followed by its record, and is listed only while that record is there. */
  sent(agentId: string): boolean
  /** Whether a run relayed from here is still at work on the machine at `url`. */
  working(url: string): boolean
  /** How the machine at `url` is reached since it was added again, for the runs kept from before. */
  rekey(url: string, key: string, pin?: string): void
  /**
   * The saved machine a run of the project runs on, whoever started it there: one this computer
   * sent, or one whose record, come through the project's shared records, names that machine's
   * computer. Undefined for a run of this computer's own, and for one of a computer that is
   * no saved machine.
   */
  home(projectId: string, agentId: string): Promise<RemoteTarget | undefined>
  /** Follow a run that runs on a saved machine, when it is not followed yet: its events then stream here, as for a run this computer sent. */
  follow(projectId: string, agentId: string): Promise<void>
  /**
   * The saved machine, by its computer's own name, as the records of its runs carry it: the name
   * it was given and its address. Asked of the machines first, when one has not said its name yet.
   */
  machineNames(): Promise<(host: string) => SavedMachine | undefined>
  /** What each saved machine says of its own runs of the project at `projectPath`, followed for a while from now on (machine-runs.ts). */
  machineRuns(projectPath: string): Promise<MachineRuns[]>
  /** Tell `changed` each time a saved machine's runs of the project at `projectPath` change, until the answer is called. */
  followRuns(projectPath: string, changed: () => void): () => void
  /** The projects of the person's other computers that this one does not have, each marked with the saved machine it is on (elsewhere.ts). */
  elsewhere(): Promise<ProjectSummary[]>
  /** What the computer another computer's project is on says of its own runs of it, followed for a while from now on. */
  elsewhereRuns(projectId: string): Promise<MachineRuns[]>
  /** Tell `changed` each time the runs of another computer's project change there, until the answer is called. */
  followElsewhereRuns(projectId: string, changed: () => void): () => void
  /** Another computer's project by its id here: the saved machine it is on, and the project as that computer said it. */
  elsewhereHome(projectId: string): Promise<{ machine: string; project: OwnProject } | undefined>
  /** Make a page's call about another computer's project on that computer, and answer what it answered. */
  forward(projectId: string, fn: string, args: unknown[]): Promise<unknown>
  /** What the person's other computers say of their Human Queues, each named as its project is here (machine-interventions.ts). */
  machinesQueue(): Promise<MachinesQueue>
  /** Where this computer's copy of the project at `address` stands; with `bring`, cloned and added when there is none, on its own. */
  bringHere(address: string, bring?: BringProject): Promise<RelayProject>
}

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
  /** A Start is near in a project, on a coding agent: have what the run will want first ready for it (its name). Never throws. */
  prepareStart: (projectId: string, driver?: string) => void
  /** The in-memory event stream for an agent relayed from a saved machine (#1067), else undefined. */
  eventsSource: EventsSource
  /** The relayed-agent lookup (#1067 slice 2), so a run-scoped RPC can tell a local agent from one
   *  running on a saved machine and forward the call there. */
  remote: RemoteAgents
  /** The user-preferences store (#410), over the registry file. */
  preferences: PreferencesStore
  /** The quota source behind the usage panel (#533). */
  quota: QuotaSource
  /** Which models each coding agent offers, for the agent and model menu. */
  models: ModelsSource
  /** Whether a newer version of a coding agent on this computer is out, and its update. */
  agentUpdates: AgentUpdates
  /** What a project currently suffers from (#1500): the daemon's error state, read per project. */
  projectErrors: ProjectErrorsReader
  /** The daemon's own bridge browser (#1332): status, and show/hide/restart on request. */
  bridgeBrowser: BridgeBrowserOwner
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

/**
 * The in-memory {@link EventsSource} (#426). It answers only for a run this daemon is relaying
 * from a saved machine (#1067) — such a run has no diary on this machine, since it works in a
 * checkout over there — and returns undefined for an ordinary local run, whose diary `onEvents`
 * tails off disk.
 */
export function contextEventsSource(): EventsSource {
  return fromContext('eventsSource')
}

/**
 * The relayed-agent lookup (#1067 slice 2). A run-scoped RPC uses it to tell an ordinary local agent
 * (resolve a local checkout) from one running on a saved machine (forward the call there). A call
 * that came in from another computer is kept from being passed on again by `asArrived`
 * (relay-agent.ts).
 */
export function contextRemote(): RemoteAgents {
  return fromContext('remote')
}

/** The user-preferences store (#410), over the registry file. */
export function contextPreferences(): PreferencesStore {
  return fromContext('preferences')
}

/** The quota source behind the usage panel (#533). */
export function contextQuota(): QuotaSource {
  return fromContext('quota')
}

/** Whether a newer version of a coding agent on this computer is out, and its update. */
export function contextAgentUpdates(): AgentUpdates {
  return fromContext('agentUpdates')
}

/** Which models each coding agent offers. */
export function contextModels(): ModelsSource {
  return fromContext('models')
}

/** What a project currently suffers from (#1500), as the daemon's background jobs last recorded it. */
export function contextProjectErrors(): ProjectErrorsReader {
  return fromContext('projectErrors')
}

/** The daemon's own bridge browser (#1332). */
export function contextBridgeBrowser(): BridgeBrowserOwner {
  return fromContext('bridgeBrowser')
}

/** The daemon's own `startAgent`, so a start from the dashboard is the same start the CLI makes. */
export function contextStartAgent(): DashboardContext['startAgent'] {
  return fromContext('startAgent')
}

/** Install + register a repo (#433), which only the daemon can do. */
export function contextAddProject(): DashboardContext['addProject'] {
  return fromContext('addProject')
}

/** Have what a Start near in a project will want ready for it (its name), which only the daemon can do. */
export function contextPrepareStart(): DashboardContext['prepareStart'] {
  return fromContext('prepareStart')
}

/** Find or add the project a second `openagent` was started in (#2141), which only the daemon can do. */
export function contextStartedIn(): DashboardContext['startedIn'] {
  return fromContext('startedIn')
}

/** Take a project off the list, which only the daemon can do: it runs the project's close hooks first. */
export function contextRemoveProject(): DashboardContext['removeProject'] {
  return fromContext('removeProject')
}

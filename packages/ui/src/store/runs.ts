import type { ProjectRef, RunEvent, RunHost, RunOptions, RunRef, RunSummary, RunsWanted } from '@openagt/hooks'

/**
 * The runs, as the shell reads them (#2394, decision 14): every `run.host` says its own, this
 * computer's and the ones beside it (a CI runner, a cloud session), and the shell reads
 * no run's files itself. A run here is the shell's page shape, {@link AgentMeta}, made from what its
 * host says ({@link metaOf}); what a module adds to a run's row (how its pull request stands, the
 * work it left on this machine) is that module's read, marked on it beside.
 */

/** How a run stands, as the pages say it. */
export type AgentStatus = 'running' | 'done' | 'stopped' | 'failed' | 'waiting'

/** A run, as the dashboard's lists and pages show it. */
export interface AgentMeta {
  status: AgentStatus
  /** Stable, path-safe id for this run (derived from {@link startedAt}). */
  id: string
  /** ISO timestamp the run started. */
  startedAt: string
  /** ISO timestamp it last changed: its end, else its start. */
  updatedAt: string
  /** ISO timestamp the run ended, absent while it is going. */
  endedAt?: string
  /** What the run cost so far in US dollars; absent until its agent says. */
  cost?: number
  /** The computer it runs or ran on, by its name. */
  host?: string
  /**
   * Whose run it is, by the email its record is kept under: the git user of the computer that
   * ran it. A run of this computer's that has no record yet is its project's git user's.
   */
  person?: string
  /** What this session was asked for. */
  intent?: string
  /** The session's short name, as a list shows it: two to five words a small model gave it. */
  title?: string
  /** Set while that name is being asked for: a list holds the run's place for it then. */
  naming?: true
  /** The branch the run was told to start from, by its name: a person's local branch picked in the launcher. Absent on a run that started from origin's default branch. */
  base?: string
  /** The commit the run's own work begins at: its changes are measured from it; absent, from the default branch. */
  baseCommit?: string
  /** The branch the run's pull request goes into; absent, the repository's default branch. */
  prBase?: string
  /** The repos a session with no project has as context: each one's name, which its copy's folder in the session's folder has, and the folder it was copied from. */
  repos?: { name: string; from: string }[]
  /** How far the run takes its work when its agent finishes: `commit`, `branch`, `pr` or `merge`; absent on a run with none. The session's "Auto" pick shows it. */
  publish?: string
  /** The last commit of the run's work, once its main agent landed it: its branch is gone, and its changes are read from this commit. */
  landed?: string
  /** The run's options, one slice per module, as its record keeps them: what its box's controls say. */
  options?: RunOptions
  /** The folder the run's agent works or worked in. */
  workspace?: string
  /** The coding agent it is on, by its id (`RunAgent.id`). */
  driver?: string
  /** The branch the agent's work is on: for a run with a checkout, the one it has out now. */
  branch?: string
  /** The pull request this session's work is on. */
  pr?: { number: number; url: string }
  /** The command that picks the run's agent session back up in a terminal, as its coding agent says it. */
  resumeCommand?: string
  /** The run was started by another computer (#1648): its {@link host} is not this one. Marked on the way to the dashboard. */
  otherHost?: boolean
  /** It ended clean and the process that ran it is still saving its record and cleaning up its checkout: the window every surface says "saving…" for. */
  saving?: boolean
  /** How the run's pull request stands ({@link pr}), as the git host last said: marked on the way to the dashboard. */
  prState?: 'open' | 'draft' | 'merged' | 'closed'
  /** The title of the run's pull request, as the git host last said: the jump finds the run by it. Marked like {@link prState}. */
  prTitle?: string
  /** The pull requests the run opened before {@link pr}, oldest first, each marked with how it stands like {@link prState}. */
  earlierPrs?: { number: number; url: string; state?: 'open' | 'draft' | 'merged' | 'closed' }[]
  /** How many commits of the run's own wait on its branch, never pushed: marked on the way to the dashboard. */
  unpublished?: number
  /** How many files the run's checkout left uncommitted, marked like {@link unpublished}. */
  uncommitted?: number
  /** Where this run executes: a host's id for a run on a host beside this computer's (`run.host`: a CI runner's, a cloud session's `web`), absent for one on this computer. */
  target?: string
  /** The model the run's agent was started with; absent when it was left on the agent's own default. */
  model?: string
  /** How hard that model was told to think, by the coding agent's own names; absent, it thinks as it does by default. */
  effort?: string
  /** How much of the model's context the conversation filled at the last turn; absent when the agent reports no reading. */
  contextTokens?: number
}

/** The origin's name a published branch is kept under in a run's options, which a page names the branch without. */
const ON_ORIGIN = 'origin/'

/** A run as its host says it, in the shell's page shape: `local` is the host that is this computer's. */
export function metaOf(run: RunSummary, local: string): AgentMeta {
  const branches = run.options?.['git-branches']
  const branchFacts = run.facts?.['git-branches']
  // The run's pull requests, as the git host's module read them back into its slice of the facts.
  const requests = run.facts?.github
  const base = branches?.base
  const branch = branchFacts?.branch
  return {
    id: run.id,
    status: run.status === 'working' ? 'running' : run.status,
    startedAt: run.startedAt,
    updatedAt: run.endedAt ?? run.startedAt,
    ...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
    ...(run.cost !== undefined ? { cost: run.cost } : {}),
    ...(run.computer !== undefined ? { host: run.computer } : {}),
    ...(run.person !== undefined ? { person: run.person } : {}),
    ...(run.prompt ? { intent: run.prompt } : {}),
    ...(run.title !== undefined ? { title: run.title } : {}),
    ...(run.naming ? { naming: true as const } : {}),
    ...(base !== undefined ? { base: base.startsWith(ON_ORIGIN) ? base.slice(ON_ORIGIN.length) : base } : {}),
    ...(branchFacts?.baseCommit !== undefined ? { baseCommit: branchFacts.baseCommit } : {}),
    ...(run.options?.github?.prBase !== undefined ? { prBase: run.options.github.prBase } : {}),
    ...(branches?.repos !== undefined ? { repos: branches.repos } : {}),
    ...(run.options?.publish !== undefined ? { publish: run.options.publish } : {}),
    ...(branchFacts?.landed !== undefined ? { landed: branchFacts.landed } : {}),
    ...(run.options !== undefined ? { options: run.options } : {}),
    ...(run.workspace !== undefined ? { workspace: run.workspace } : {}),
    ...(run.agent !== undefined ? { driver: run.agent.id } : {}),
    ...(run.agent?.model !== undefined ? { model: run.agent.model } : {}),
    ...(run.agent?.effort !== undefined ? { effort: run.agent.effort } : {}),
    ...(run.contextTokens !== undefined ? { contextTokens: run.contextTokens } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(requests?.pr ? { pr: requests.pr } : {}),
    ...(requests?.earlierPrs ? { earlierPrs: requests.earlierPrs } : {}),
    ...(run.session?.resume !== undefined ? { resumeCommand: run.session.resume } : {}),
    ...(run.saving ? { saving: true } : {}),
    ...(run.host !== local ? { target: run.host } : {}),
  }
}

/** Where the shell asks about runs: every host of a project, this computer's first. */
export interface RunHosts {
  /** This computer's host, by its id (`LOCAL_HOST`). */
  local: string
  /** The hosts a project's runs are on, this computer's first; a session with no project's too. */
  of(project?: ProjectRef): Promise<RunHost[]>
}

/** Newest run first: an id sorts chronologically, so the id order is the time order. */
const byIdDesc = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

/**
 * A project's runs, or the sessions with no project, newest first, as every host of it says them:
 * one row per run, the first host that has it keeping it. A host that cannot answer has none.
 */
export async function readRuns(hosts: RunHosts, project: ProjectRef | undefined, wanted: RunsWanted = {}): Promise<AgentMeta[]> {
  const answers = await Promise.all((await hosts.of(project)).map(host => host.list(project, wanted).catch((): RunSummary[] => [])))
  const seen = new Set<string>()
  return answers
    .flat()
    .filter(run => !seen.has(run.id) && seen.add(run.id))
    .map(run => metaOf(run, hosts.local))
    .sort(byIdDesc)
}

/** One run, as its host says it; none when no host has it. */
export async function readRun(hosts: RunHosts, project: ProjectRef | undefined, id: string): Promise<AgentMeta | undefined> {
  return (await readRuns(hosts, project, { ids: [id] }))[0]
}

/** How long a read of a run's events waits for its host to have them all: a run just started has its diary a moment later. */
const EVENTS_WAIT_MS = 5_000

/**
 * A run's events as they are now, for a reader that replays them: what its host streams up to the
 * end-of-replay marker. None for a host that streams no events.
 */
export async function readRunEvents(host: RunHost, run: RunRef): Promise<RunEvent[] | undefined> {
  if (!host.events) return undefined
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), EVENTS_WAIT_MS)
  const events: RunEvent[] = []
  try {
    for await (const event of host.events(run, stop.signal)) {
      if (event.kind === 'stream-sync') break
      if (event.kind !== 'partial') events.push(event)
    }
  } finally {
    clearTimeout(timer)
    stop.abort()
  }
  return events
}

/** How long a line saying what a run is doing may be. */
const DOING_MAX = 140

/**
 * What a working run is doing, as its row of a list of subagents says it: the last thing it did (a
 * tool it used, with what) or said, on one line; the last tool it used; and how many calls it made so far.
 */
export interface AgentDoing {
  doing?: string
  tool?: string
  calls: number
}

/** What a run's events say it is doing; none when they say no step and no word. */
export function doingOf(events: readonly RunEvent[]): AgentDoing | undefined {
  let doing: string | undefined
  let tool: string | undefined
  let calls = 0
  for (const event of events) {
    if (event.kind !== 'driver') continue
    const driven = event.event
    const text = driven.type === 'action' ? (driven.detail !== undefined ? `${driven.label} ${driven.detail}` : driven.label) : driven.type === 'text' ? driven.text : undefined
    if (driven.type === 'action') {
      calls++
      tool = driven.label
    }
    const flat = text?.replace(/\s+/g, ' ').trim()
    if (flat) doing = flat.length > DOING_MAX ? flat.slice(0, DOING_MAX - 1) + '…' : flat
  }
  if (doing === undefined && calls === 0) return undefined
  return { ...(doing !== undefined ? { doing } : {}), ...(tool !== undefined ? { tool } : {}), calls }
}

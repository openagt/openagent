import type { AgentMeta, AgentStatus } from '../store/index.js'
import { contextRuns } from '../dashboard-rpc/context.js'
import type { ProjectSummary } from './projects.js'
import { hostname } from 'node:os'
import { SESSIONS_ID } from '../project-address.js'

// The first-sidebar Overview (#437, part of #314): a cross-project glance at what the agent
// is working on right now, and the recently active projects. It rolls up across the whole
// registry what each project's hosts say of its runs (`run.host`), and each project's last
// activity (ProjectSummary.lastActivityAt from its runs). The queue's size is the queue's own part
// of the Overview's line.

/** One project's in-flight run, surfaced in the Overview's "working now" list. */
export interface ActiveAgent {
  projectId: string
  projectName: string
  /** Which run this is (#738): a project can have several in flight, one per worktree. */
  agentId: string
  status: AgentStatus
  /** What the user asked to build (the agent's `scope` event). */
  intent?: string
  /** The run's short name, the branch it works on and when it started: what every list names a run by (`runName`). */
  title?: string
  /** Whether that name is being asked for ({@link AgentMeta.naming}). */
  naming?: true
  branch?: string
  startedAt: string
  scope?: string
  /** ISO timestamp of the agent's last event. */
  updatedAt?: string
  /**
   * The host beside this computer's it runs on, by its id (`run.host`, #2394: a CI runner's, Claude
   * Code on the web's `web`). No checkout here backs it, so it is listed because
   * its record says it is at work: "no agents working" over a cloud session at work was a lie (#1668).
   */
  host?: string
  /** The computer it runs on, only when that is not this one: the computer its record names (#1648). */
  computer?: { name: string }
}

/** One recently active project, most-recent first. */
export interface RecentProject {
  projectId: string
  projectName: string
  lastActivityAt?: string
}

/** The cross-project Overview payload. */
export interface Overview {
  /** Projects with a running agent, most-recently-updated first. */
  active: ActiveAgent[]
  /** The most recently active projects (capped). */
  recent: RecentProject[]
}

/** One recent session, tagged with the project it belongs to, for the cross-project rail; a session with no project is tagged {@link SESSIONS_ID}, with no name. */
export interface RecentAgent {
  projectId: string
  projectName: string
  agent: AgentMeta
}

/** How many recent projects the Overview surfaces. */
const RECENT_LIMIT = 5

/** How many recent sessions the home rail pools across every project. */
const RECENT_RUNS_LIMIT = 30

/** A run as the jump finds it (`onAllAgents`): what it is named and found by, and where it is. */
export interface FoundAgent {
  projectId: string
  projectName: string
  agent: Pick<AgentMeta, 'id' | 'status' | 'title' | 'intent' | 'branch' | 'pr' | 'prTitle' | 'startedAt'>
}

/** Injectable reader so {@link buildRecentAgents} is unit-testable off disk. */
export interface RecentAgentsDeps {
  /** A project's runs: off its folder for one of this computer's, as its computer says them for another's. */
  agents?: (project: ProjectSummary) => Promise<AgentMeta[]>
  /** The sessions with no project; none when absent. */
  sessions?: () => Promise<AgentMeta[]>
}

/**
 * Every project's sessions, and the sessions with no project, pooled and sorted newest-first (the first `limit`), so the shared sidebar (#shared-
 * shell) can show recents on the home/Overview where no single project is selected. Each row carries
 * the project it belongs to, so selecting it jumps into that project's session. Forgiving — a project
 * whose agents cannot be read simply contributes nothing.
 */
export async function buildRecentAgents(projects: ProjectSummary[], deps: RecentAgentsDeps = {}, limit = RECENT_RUNS_LIMIT): Promise<RecentAgent[]> {
  const readAgents = deps.agents ?? contextRuns
  // Every project at once: each one's read is a git read of its branches too (the rows' marks), and
  // one after the other the list waited for all of them in turn. Kept in the projects' order, so
  // the first project to list a run still keeps it below.
  const [read, sessions] = await Promise.all([Promise.all(projects.map(project => readAgents(project).catch((): AgentMeta[] => []))), (deps.sessions ?? (async () => []))().catch((): AgentMeta[] => [])])
  const all: RecentAgent[] = [
    ...projects.flatMap((project, at) => (read[at] ?? []).map(agent => ({ projectId: project.id, projectName: project.name, agent }))),
    ...sessions.map(agent => ({ projectId: SESSIONS_ID, projectName: '', agent })),
  ]
  all.sort((a, b) => (b.agent.startedAt ?? '').localeCompare(a.agent.startedAt ?? ''))
  // One row per run (#1648): two checkouts of one repository share their archive, so every run
  // was listed once per checkout; the first project to list it keeps it.
  const seen = new Set<string>()
  return all.filter(row => !seen.has(row.agent.id) && seen.add(row.agent.id)).slice(0, limit)
}

/** Injectable readers so {@link buildOverview} is unit-testable off disk. */
export interface OverviewDeps {
  /** Every run of a project, as its hosts say them (default {@link contextRuns}). */
  agents?: (project: ProjectSummary) => Promise<AgentMeta[]>
  /** This machine's hostname; `node:os` in production. */
  host?: string
}

/**
 * Build the cross-project Overview: the runs at work (every one of each project's, one per
 * worktree since #736, and the ones on a host beside this computer's), and the most recently
 * active projects (by {@link ProjectSummary.lastActivityAt}). Forgiving — a project with no run
 * at work simply contributes nothing to `active`.
 */
export async function buildOverview(projects: ProjectSummary[], deps: OverviewDeps = {}): Promise<Overview> {
  const agents = deps.agents ?? contextRuns
  const thisHost = deps.host ?? hostname()

  const active: ActiveAgent[] = []
  // One entry per run across projects: two checkouts of one repository share their records, so
  // the same run is in both projects' lists; the first project to list it keeps it.
  const seen = new Set<string>()
  const entry = (project: ProjectSummary, meta: AgentMeta): ActiveAgent => ({
    projectId: project.id,
    projectName: project.name,
    agentId: meta.id,
    status: meta.status,
    ...(meta.intent ? { intent: meta.intent } : {}),
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.naming ? { naming: meta.naming } : {}),
    ...(meta.branch ? { branch: meta.branch } : {}),
    startedAt: meta.startedAt,
    ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
    // Another computer's daemon started it (#1648): the shared data branch shows its runs here too.
    ...(meta.host !== undefined && meta.host !== thisHost ? { computer: { name: meta.host } } : {}),
    // A host beside this computer's (`run.host`): "no agents working" over a cloud session at work was a lie (#1668).
    ...(meta.target !== undefined ? { host: meta.target } : {}),
  })
  for (const project of projects) {
    for (const meta of await agents(project).catch((): AgentMeta[] => [])) {
      // At work here, or on a host beside this computer's; another computer's run is that computer's to show.
      if (meta.status !== 'running' || seen.has(meta.id) || (meta.target === undefined && meta.host !== undefined && meta.host !== thisHost)) continue
      seen.add(meta.id)
      active.push(entry(project, meta))
    }
  }
  active.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

  const recent = projects
    .filter(p => p.lastActivityAt)
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
    .slice(0, RECENT_LIMIT)
    .map(p => ({ projectId: p.id, projectName: p.name, lastActivityAt: p.lastActivityAt! }))

  return { active, recent }
}

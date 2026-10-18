import { readAllAgents, readLiveMetas, type LiveAgent, type AgentMeta, type AgentStatus } from '../store/index.js'
import type { ProjectSummary } from './projects.js'
import { collectQueue, type ProjectQueue } from './queue.js'
import { cloudRunState } from '../cloud-run-state.js'
import { bridgeQuestions } from './bridge-store.js'
import { hostname } from 'node:os'

// The first-sidebar Overview (#437, part of #314): a cross-project glance at what the agent
// is working on right now, the size of the backlog, and the recently active projects. It
// rolls up three existing file projections across the whole registry — the card a run's tool
// keeps in the run's own checkout, the TODO queue (queue.ts), and each project's last activity
// (ProjectSummary.lastActivityAt from its runs).

/** One project's in-flight run, surfaced in the Overview's "working now" list. */
export interface ActiveAgent {
  projectId: string
  projectName: string
  /** Which run this is (#738): a project can have several in flight, one per worktree. */
  agentId: string
  /** The agent's own checkout, so its git/file status is read from the worktree it edits (#738). */
  cwd: string
  status: AgentStatus
  /** What the user asked to build (the agent's `scope` event). */
  intent?: string
  scope?: string
  /** ISO timestamp of the agent's last event. */
  updatedAt?: string
  /**
   * A web run at work on its cloud side (#1668): in its session, or parked on a question the
   * bridge reported. Its local half is over, so it is not a live agent — it is listed because the
   * cloud side is the agent, and "no agents working" over a waiting cloud session was a lie.
   */
  cloud?: 'in-cloud' | 'waiting'
  /** The machine whose daemon started it (#1648), only when that is not this one. */
  host?: string
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
  /** Total open TODO items across every project. */
  queueOpen: number
  /** The most recently active projects (capped). */
  recent: RecentProject[]
}

/** One recent session, tagged with the project it belongs to, for the cross-project rail. */
export interface RecentAgent {
  projectId: string
  projectName: string
  agent: AgentMeta
}

/** How many recent projects the Overview surfaces. */
const RECENT_LIMIT = 5

/** How many recent sessions the home rail pools across every project. */
const RECENT_RUNS_LIMIT = 30

/** Injectable reader so {@link buildRecentAgents} is unit-testable off disk. */
export interface RecentAgentsDeps {
  agents?: (cwd: string) => Promise<AgentMeta[]>
}

/**
 * Every project's sessions pooled and sorted newest-first (capped), so the shared sidebar (#shared-
 * shell) can show recents on the home/Overview where no single project is selected. Each row carries
 * the project it belongs to, so selecting it jumps into that project's session. Forgiving — a project
 * whose agents cannot be read simply contributes nothing.
 */
export async function buildRecentAgents(projects: ProjectSummary[], deps: RecentAgentsDeps = {}): Promise<RecentAgent[]> {
  const readAgents = deps.agents ?? readAllAgents
  // Every project at once: each one's read is a git read of its branches too (the rows' marks), and
  // one after the other the list waited for all of them in turn. Kept in the projects' order, so
  // the first project to list a run still keeps it below.
  const read = await Promise.all(projects.map(project => readAgents(project.path).catch((): AgentMeta[] => [])))
  const all: RecentAgent[] = projects.flatMap((project, at) => (read[at] ?? []).map(agent => ({ projectId: project.id, projectName: project.name, agent })))
  all.sort((a, b) => (b.agent.startedAt ?? '').localeCompare(a.agent.startedAt ?? ''))
  // One row per run (#1648): two checkouts of one repository share their archive, so every run
  // was listed once per checkout; the first project to list it keeps it.
  const seen = new Set<string>()
  return all.filter(row => !seen.has(row.agent.id) && seen.add(row.agent.id)).slice(0, RECENT_RUNS_LIMIT)
}

/** Injectable readers so {@link buildOverview} is unit-testable off disk. */
export interface OverviewDeps {
  liveAgents?: (cwd: string) => Promise<LiveAgent[]>
  queue?: (projects: ProjectSummary[]) => Promise<ProjectQueue[]>
  /** Every run of a project, archived included (default {@link readAllAgents}): where the web runs are. */
  agents?: (cwd: string) => Promise<AgentMeta[]>
  /** Whether the bridge holds a question for that cloud session (default: the daemon's bridge store). */
  waiting?: (sessionId: string) => boolean
  now?: () => number
  /** This machine's hostname; `node:os` in production. */
  host?: string
}

/**
 * Build the cross-project Overview: the running agents (every live agent of each project, one per
 * worktree since #736), the total of open queue entries (from {@link collectQueue}), and the most
 * recently active projects (by {@link ProjectSummary.lastActivityAt}). Forgiving — a project
 * with no live run, or none running, simply contributes nothing to `active`.
 */
export async function buildOverview(projects: ProjectSummary[], deps: OverviewDeps = {}): Promise<Overview> {
  const liveAgents = deps.liveAgents ?? readLiveMetas
  const queue = deps.queue ?? (p => collectQueue(p))
  const agents = deps.agents ?? readAllAgents
  const waiting = deps.waiting ?? (sessionId => bridgeQuestions().waiting(sessionId))
  const now = (deps.now ?? Date.now)()
  const thisHost = deps.host ?? hostname()

  const active: ActiveAgent[] = []
  // One entry per web run across projects: two checkouts of one repository share their archive,
  // so the same run is in both projects' lists; the first project to list it keeps it.
  const cloudSeen = new Set<string>()
  const entry = (project: ProjectSummary, meta: AgentMeta, cwd: string): ActiveAgent => ({
    projectId: project.id,
    projectName: project.name,
    agentId: meta.id,
    cwd,
    status: meta.status,
    ...(meta.intent ? { intent: meta.intent } : {}),
    ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
    // Another machine's daemon started it (#1648): the shared data branch shows its runs here too.
    ...(meta.host !== undefined && meta.host !== thisHost ? { host: meta.host } : {}),

  })
  for (const project of projects) {
    // Every live agent of the project (#738), not just the one that used to sit at its path.
    for (const meta of await liveAgents(project.path).catch(() => [])) {
      if (meta.status !== 'running') continue
      active.push(entry(project, meta, meta.cwd))
    }
    // The web runs whose cloud side is still at work (#1668): their local half is over and their
    // checkout may be gone, so they are read from the archive and keyed to the project's own path.
    for (const meta of await agents(project.path).catch((): AgentMeta[] => [])) {
      if (meta.target !== 'web' || cloudSeen.has(meta.id)) continue
      const state = cloudRunState({ ...meta, cloudWaiting: meta.sessionId !== undefined && waiting(meta.sessionId) }, now)
      if (state !== 'in-cloud' && state !== 'waiting') continue
      cloudSeen.add(meta.id)
      active.push({ ...entry(project, meta, project.path), cloud: state })
    }
  }
  active.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

  const queues = await queue(projects)
  const queueOpen = queues.reduce((sum, q) => sum + q.entries.length, 0)

  const recent = projects
    .filter(p => p.lastActivityAt)
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
    .slice(0, RECENT_LIMIT)
    .map(p => ({ projectId: p.id, projectName: p.name, lastActivityAt: p.lastActivityAt! }))

  return { active, queueOpen, recent }
}

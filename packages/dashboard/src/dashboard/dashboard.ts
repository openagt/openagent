import type { ProjectSummary } from './projects.js'
import { collectQueue, type ProjectQueue } from './queue.js'
import { projectTickets } from '../store/tickets.js'
import { buildOverview, type ActiveAgent, type OverviewDeps } from './overview.js'

// The Overview dashboard page (#471): the cross-project rollup that used to live cramped in
// the first sidebar, promoted to a real at-a-glance page. It reuses buildOverview for the
// "working now" facts and adds what the page and the onboarding checklist ask of it. Still a pure
// projection of the same files (each run's card, and the queue).
//
// It used to carry more: per-project agent counts, how past agents ended, and a two-week activity
// window. #1139 cut the surfaces that drew them and left the numbers being computed for nobody —
// which cost a `listAgents` fan-out over every project's whole archive on each poll, twice a cycle
// between the two pollers. What is left is what someone reads.

/** One project's rollup row. */
export interface ProjectStat {
  projectId: string
  /** Whether the repo has any ticket in `tickets/` (#958) — presence only, not a count. */
  hasTickets: boolean
  /** Whether one of the project's packages provides tickets at all (#1774): without one, there is nothing to populate. */
  providesTickets: boolean
}

/** The dashboard page payload (#471). */
export interface DashboardData {
  totals: {
    projects: number
    openTodos: number
  }
  /** Agents going right now, most-recently-updated first (from {@link buildOverview}). */
  active: ActiveAgent[]
  /** Every registered project, most-recently-active first. */
  projects: ProjectStat[]
  /** The per-project agent queue (from {@link collectQueue}): the projects that have one, with their open entries. */
  queue: ProjectQueue[]
}

/** Injectable readers so {@link buildDashboard} is unit-testable off disk. */
export interface DashboardDeps extends OverviewDeps {
  /** Whether a project has tickets (#958). Defaults to the provider's list being non-empty (false on any error). */
  tickets?: (cwd: string) => Promise<boolean>
  /** Whether a project's packages provide tickets (#1774). Defaults to the provider lookup (false on any error). */
  providesTickets?: (cwd: string) => Promise<boolean>
}

/** Whether the provider one of the project's packages declares (#1774) lists any ticket; no provider, no tickets. */
async function hasProvidedTickets(cwd: string): Promise<boolean> {
  try {
    const source = await projectTickets(cwd)
    return source !== undefined && (await source.list()).length > 0
  } catch {
    return false
  }
}

/**
 * Build the Overview dashboard: the {@link buildOverview} rollup (working now / queue) plus the
 * per-project ticket presence the onboarding checklist reads. Forgiving — a project whose state
 * cannot be read simply contributes nothing.
 */
export async function buildDashboard(projects: ProjectSummary[], deps: DashboardDeps = {}): Promise<DashboardData> {
  const hasTicketsFor = deps.tickets ?? hasProvidedTickets
  const providesTicketsFor = deps.providesTickets ?? (cwd => projectTickets(cwd).then(source => source !== undefined, () => false))

  // Compute the queue once and hand it to buildOverview so the backlog is read a single time.
  const queue = await (deps.queue ?? (p => collectQueue(p)))(projects)
  const overview = await buildOverview(projects, { ...deps, queue: async () => queue })

  // Most-recently-active first: the checklist takes the head of this list as the project to act
  // on, so the order is the output here even though the timestamp itself is not.
  const ordered = [...projects].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
  const projectStats: ProjectStat[] = []
  for (const project of ordered) {
    projectStats.push({ projectId: project.id, hasTickets: await hasTicketsFor(project.path), providesTickets: await providesTicketsFor(project.path) })
  }

  return {
    totals: {
      projects: projects.length,
      openTodos: overview.queueOpen,
    },
    active: overview.active,
    projects: projectStats,
    queue,
  }
}

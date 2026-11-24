import type { ProjectSummary } from './projects.js'
import { buildOverview, type ActiveAgent, type OverviewDeps } from './overview.js'

// The Overview dashboard page (#471): the cross-project rollup that used to live cramped in
// the first sidebar, promoted to a real at-a-glance page. It reuses buildOverview for the
// "working now" facts and adds what the onboarding checklist asks of it. Still a pure
// projection of the same files (each run's card).
//
// It used to carry more: per-project agent counts, how past agents ended, and a two-week activity
// window. #1139 cut the surfaces that drew them and left the numbers being computed for nobody —
// which cost a `listAgents` fan-out over every project's whole archive on each poll, twice a cycle
// between the two pollers. The queue's and the tickets' counts are their modules' own (#2394). What
// is left is what someone reads.

/** The dashboard page payload (#471). */
export interface DashboardData {
  totals: {
    projects: number
  }
  /** Agents going right now, most-recently-updated first (from {@link buildOverview}). */
  active: ActiveAgent[]
}

/** Injectable readers so {@link buildDashboard} is unit-testable off disk. */
export type DashboardDeps = OverviewDeps

/**
 * Build the Overview dashboard: the {@link buildOverview} rollup (working now) and how many projects
 * there are. Forgiving — a project whose state cannot be read simply contributes nothing.
 */
export async function buildDashboard(projects: ProjectSummary[], deps: DashboardDeps = {}): Promise<DashboardData> {
  const overview = await buildOverview(projects, deps)
  return { totals: { projects: projects.length }, active: overview.active }
}

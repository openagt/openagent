import { readAllAgents, type AgentMeta, type AgentStatus } from '../store/index.js'
import type { ProjectSummary, ProjectionRead } from './projects.js'

// The identity + diff live in the leaf `keys.ts` so the dashboard can share them (they are pure);
// re-exported here so this stays the import site for anything that already reads them from the
// module that defines `Activity`.
export { activityKey } from './keys.js'

// The "New activity" feed (#627): the cross-project stream of run lifecycle transitions that
// do NOT need the human — an agent started, an agent finished. It is the default-off notification
// category, the counterpart to the interventions queue (which is the always-on "needs you"
// half). Same shape and same "only genuinely new" diff as interventions.ts, so the browser
// hook folds it into a baseline on first look and then notifies once per transition — you hear
// an agent kick off and an agent land, nothing when the page opens.

/** How many recent agents per project to consider. Bounds the finished-set — older agents rolled off
 * long ago and were already baselined, so they never fire. A running agent is always newest (live
 * meta is prepended), so it is always in range. */
const RECENT_RUNS = 20

/**
 * One agent lifecycle event worth a passing mention. Two kinds: an agent `started` (entered
 * `running`) or `finished` (reached a terminal status). The card is not shown for these — they
 * only drive notifications — so the fields are just what a notification line needs.
 */
export interface Activity {
  projectId: string
  projectName: string
  /** The agent this is about. */
  agentId: string
  /** `started` = the agent entered `running`; `finished` = it reached a terminal status. */
  kind: 'started' | 'finished'
  /** What the agent is building (its `intent`), for the notification body; may be absent. */
  title?: string
  /** The finished agent's terminal status (`finished` only), so a stop reads differently from a done. */
  status?: AgentStatus
  /** When the agent last changed, ISO, for ordering and the baseline diff. */
  updatedAt?: string
}

/** Injectable seam so {@link buildActivity} is unit-testable off disk. */
export interface ActivityDeps {
  /** A project's runs, live prepended to the archived history, newest-first: off its folder by default, as its computer says them for another computer's. */
  readAgents?: (project: ProjectSummary) => Promise<AgentMeta[]>
}

/** Map one agent to its current activity item: `started` while running, else `finished`. */
function activityFor(project: ProjectSummary, agent: AgentMeta): Activity {
  const kind = agent.status === 'running' ? 'started' : 'finished'
  return {
    projectId: project.id,
    projectName: project.name,
    agentId: agent.id,
    kind,
    ...(agent.intent ? { title: agent.intent } : {}),
    ...(kind === 'finished' ? { status: agent.status } : {}),
    ...(agent.updatedAt ? { updatedAt: agent.updatedAt } : {}),
  }
}

/**
 * Build the cross-project activity feed: for each registered project's most recent agents, one
 * item per agent reflecting where it is now (`started` while it runs, `finished` once it lands),
 * newest first. Forgiving — a project whose agents cannot be read simply contributes nothing, and
 * comes back named as one that was *not* read whole (#1623), since "nothing happened there" and
 * "I could not look" are the same empty list to everyone but the notification watcher.
 *
 * The `started` and `finished` items for one agent carry distinct keys ({@link activityKey}), so a
 * run that is still going notifies once (started) and again when it lands (finished). An agent that
 * both starts and finishes between two polls is only ever seen terminal, so it notifies once
 * (finished) — one quick agent, one line.
 */
export async function buildActivity(
  projects: ProjectSummary[],
  deps: ActivityDeps = {},
): Promise<ProjectionRead<Activity>> {
  const readAgents = deps.readAgents ?? (project => readAllAgents(project.path))
  const items: Activity[] = []
  const whole: string[] = []
  for (const project of projects) {
    const read = await readAgents(project).catch(() => undefined)
    if (!read) continue
    whole.push(project.id)
    for (const agent of read.slice(0, RECENT_RUNS)) items.push(activityFor(project, agent))
  }
  items.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  return { items, whole }
}

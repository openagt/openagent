import { listAgents, loadAgentEvents, readLiveMetas, type LiveAgent, type AgentMeta } from '../store/index.js'
import { pendingChoices } from '../open-choices.js'
import type { OpenAgentEvent } from '../events.js'
import type { ProjectSummary, ProjectionRead } from './projects.js'
import { projectBranches, type BranchesFor } from '../store/branches.js'
import { unpublishedRuns, type Unpublished } from './unpublished.js'
import { openPrs, type PrLister } from './pull-requests.js'
import { interventionKey } from './keys.js'

// Pure identity + diff, in the leaf `keys.ts` so the dashboard shares them rather than copying.
export { interventionKey } from './keys.js'

// The interventions queue (#632, part of the Queue #624): the cross-project "needs you" list.
// Rom's design (#624): proposals and finished work are both just PRs, so the bulk of what
// needs a human is the set of open PRs across the registered projects — merge to confirm,
// close to reject. This rolls those up, the same way overview.ts rolls up running runs. The
// second source (#636) is a run waiting on the question it ended on (#1774), until the user
// answers. #627 notifications ride this whole set.

/**
 * One item awaiting the human. Two kinds: an open `pr` to review/merge or close, and an
 * `awaiting` run paused on a choice gate. The card and the browser hook both iterate the flat
 * list, branching on `kind` for the fields that differ.
 */
export interface Intervention {
  projectId: string
  projectName: string
  /**
   * `pr` = an open PR to review/merge or close; `awaiting` = a run waiting on the question it ended on (#636/#1774);
   * `unpushed` = a finished agent whose branch has commits that were never pushed (#860).
   */
  kind: 'pr' | 'awaiting' | 'unpushed'
  title: string
  /** The PR on the git host (`pr` only): where a click takes the user. */
  url?: string
  /** The PR number (`pr` only). */
  number?: number
  /** The question's id (`awaiting` only) — its stable identity, so it notifies exactly once. */
  awaitId?: string
  /** Which run this is about (`awaiting` #738 / `unpushed`): a project has several agents. */
  agentId?: string
  /** The branch the work is sitting on (`unpushed` only). */
  branch?: string
  /** How many commits are waiting (`unpushed` only). */
  commits?: number
  /** When the PR was opened (`pr`) or the agent last updated (the other two), ISO, for ordering. */
  createdAt?: string
}

/** Injectable seam so {@link buildInterventions} is unit-testable off disk. */
export interface InterventionsDeps {
  prs?: PrLister
  /** The reader of the runs that have a checkout (default {@link readLiveMetas}): a waiting run keeps its own; drives the `awaiting` source (#636). */
  liveAgents?: (cwd: string) => Promise<LiveAgent[]>
  /** One run's events, by the project's path and the run's id (default {@link loadAgentEvents}): where a waiting run's question is read. */
  events?: (cwd: string, agentId: string) => Promise<OpenAgentEvent[] | undefined>
  /** The finished-agent reader (default {@link listAgents}); drives the `unpushed` source (#860). */
  agents?: (cwd: string) => Promise<AgentMeta[]>
  /** The project's checkouts and branches (default the project's provider, {@link projectBranches}): where a branch's state is read; drives the `unpushed` source (#860). */
  branches?: BranchesFor
}

/**
 * Build the cross-project interventions queue: every registered project's open PRs, plus any run
 * currently paused on a choice gate (#636), newest first. Forgiving — a project with no remote
 * (or an unreadable one) simply contributes nothing. Hand-opened draft PRs are excluded: they are
 * not yet asking for review. A draft on an agent's branch is not (#1102): an agent publishes a
 * draft when a person should look first, and cloud work adoption opens its PRs as drafts.
 *
 * Which projects were read whole comes back alongside the items (#1623): forgiveness here is what
 * lets one unreachable project keep the queue useful, and it is also what would let that project's
 * whole backlog announce itself as new the moment it came back. The queue's panels ignore this;
 * the notification watcher is the caller that cannot.
 */
export async function buildInterventions(
  projects: ProjectSummary[],
  deps: InterventionsDeps = {},
): Promise<ProjectionRead<Intervention>> {
  const prs = deps.prs ?? openPrs
  const liveAgents = deps.liveAgents ?? readLiveMetas
  const events = deps.events ?? loadAgentEvents
  const items: Intervention[] = []
  const whole: string[] = []
  for (const project of projects) {
    // A project is read whole only when every one of its sources answered. Each `unread()` below is
    // a source that did not, and contributed nothing for a reason other than nothing being there.
    let sawEverything = true
    const unread = () => {
      sawEverything = false
      return []
    }
    const open = await prs(project.path).catch(unread)
    // The branches the project's runs are on, recorded or in a checkout (#1774): what tells a
    // run's draft from one opened by hand. Read only when a draft asks.
    let runBranches: Set<string> | undefined
    const isRunBranch = async (branch: string): Promise<boolean> => {
      runBranches ??= new Set(
        [...(await (deps.agents ?? listAgents)(project.path).catch(() => [])), ...(await liveAgents(project.path).catch(() => []))].flatMap(agent => (agent.branch ? [agent.branch] : [])),
      )
      return runBranches.has(branch)
    }
    for (const pr of open) {
      // A draft opened by hand is not asking for review, so it stays off the queue. A draft on a
      // run's branch is the opposite (#1102): the agent, or cloud work adoption, opened it as a
      // draft so it does not ping reviewers, and if the queue then dropped it too, nothing
      // would tell anyone the work exists — which is the whole of #860 again.
      if (pr.isDraft && !(pr.headRefName !== undefined && (await isRunBranch(pr.headRefName)))) continue
      items.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'pr',
        number: pr.number,
        title: pr.title,
        url: pr.url,
        ...(pr.createdAt ? { createdAt: pr.createdAt } : {}),
      })
    }
    // A run that ended on a question waits for the user, a "needs you" too (#636): it ended
    // `waiting`, its checkout kept for the answer (#1774). The question is read off the run's own
    // diary by the rule the run page and the open-questions list use, so the ping names the question
    // they offer; a waiting run whose diary shows none is skipped. A project has several runs
    // (#736), so each waiting run contributes its own item — keyed on the question's id, plus the
    // agent id so two runs are told apart.
    for (const meta of await liveAgents(project.path).catch(unread)) {
      if (meta.status !== 'waiting') continue
      const choice = pendingChoices((await events(project.path, meta.id).catch(() => undefined)) ?? []).at(-1)
      if (!choice) continue
      items.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'awaiting',
        title: choice.title,
        awaitId: choice.id,
        agentId: meta.id,
        ...(meta.updatedAt ? { createdAt: meta.updatedAt } : {}),
      })
    }
    // A finished agent whose work never left the machine is a "needs you" too (#860). Until now the
    // queue only knew about a PR that is *already on the git host* and an agent parked on a gate, so an agent
    // that committed real code and stopped produced neither, and nothing told anyone: the overview
    // drops it (it filters on `running`) and the handoff panel is behind clicking into that agent.
    //
    // Surfacing only: this says there is a decision waiting, it does not take it. A run publishes
    // nothing by itself, so every finished run with work of its own reaches here until a person
    // publishes it, or the agent does on their ask.
    for (const item of await unpushedFor(project, deps, unread).catch(unread)) items.push(item)
    if (sawEverything) whole.push(project.id)
  }
  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  // The same repo can be registered under two projects (e.g. a monorepo root + a subdir), so a
  // PR would otherwise appear once per entry. Collapse by identity, keeping the first (newest-sorted).
  const seen = new Set<string>()
  const unique = items.filter(item => (seen.has(interventionKey(item)) ? false : (seen.add(interventionKey(item)), true)))
  return { items: unique, whole }
}

/**
 * The finished runs of a project whose work never left this machine (#860), as
 * {@link unpublishedRuns} finds them for the list of runs too. The provider answers git facts
 * only, so the git host PR lookup the handoff summary makes per branch is never paid here: an
 * open PR means the branch was pushed, and the `pr` kind above is what surfaces it.
 */
async function unpushedFor(
  project: ProjectSummary,
  deps: InterventionsDeps,
  unread: () => void,
): Promise<Intervention[]> {
  const agents = await (deps.agents ?? listAgents)(project.path)
  let found: Map<string, Unpublished>
  try {
    found = await unpublishedRuns(project.path, agents, deps.branches ?? projectBranches)
  } catch {
    unread()
    return []
  }
  return agents.flatMap(agent => {
    const work = found.get(agent.id)
    if (!work) return []
    return [
      {
        projectId: project.id,
        projectName: project.name,
        kind: 'unpushed' as const,
        // What was asked, else the run's own name, else the branch: never a prefix cut off here.
        title: agent.intent?.trim() || agent.title?.trim() || work.branch,
        agentId: agent.id,
        branch: work.branch,
        commits: work.commits,
        ...(agent.updatedAt ? { createdAt: agent.updatedAt } : {}),
      },
    ]
  })
}

import { listAgents, loadAgentEvents, readLiveMetas, type LiveAgent, type AgentMeta } from '../store/index.js'
import { pendingChoices } from '../open-choices.js'
import type { ChoiceRequest, OpenAgentEvent } from '../events.js'
import type { ProjectSummary, ProjectionRead } from './projects.js'
import { projectBranches, type BranchesFor } from '../store/branches.js'
import { unpublishedRuns, type Unpublished } from './unpublished.js'
import { cachedOpenPrs, type PrLister } from './pull-requests.js'
import { interventionKey } from './keys.js'
import { runName } from '../run-name.js'
import { bridgeChoiceRequest, type BridgeQuestion } from './bridge-question.js'
import { bridgeQuestions } from './bridge-store.js'
import type { MachineKind } from '../reached-by-line.js'

// Pure identity + diff, in the leaf `keys.ts` so the dashboard shares them rather than copying.
export { interventionKey } from './keys.js'

// The interventions queue (#632, part of the Queue #624): the cross-project "needs you" list.
// Rom's design (#624): proposals and finished work are both just PRs, so the bulk of what
// needs a human is the set of open PRs across the registered projects — merge to confirm,
// close to reject. This rolls those up, the same way overview.ts rolls up running runs. The
// second source (#636) is a run waiting on the question it ended on (#1774), until the user
// answers. #627 notifications ride this whole set.

/**
 * One item awaiting the human: an open `pr` to review and merge or close, a run `awaiting` the
 * answer to its question, or a finished run's work left `uncommitted` or `unpushed`. The Human
 * Queue, the launcher's "Waiting on you" and the browser hook all iterate the flat list, branching
 * on `kind` for the fields that differ.
 */
export interface Intervention {
  projectId: string
  projectName: string
  /**
   * `pr` = an open PR to review/merge or close; `awaiting` = a run waiting on the question it ended on (#636/#1774);
   * `uncommitted` = a finished run whose checkout holds files it never committed; `unpushed` = a finished
   * run whose branch has commits that were never pushed (#860).
   */
  kind: 'pr' | 'awaiting' | 'uncommitted' | 'unpushed'
  /** The run's name, as every list names it ({@link runName}); a request no run here opened goes by its own title. */
  title: string
  /** What the run asks (`awaiting` only). */
  question?: string
  /** The PR on the git host (`pr` only): where a click takes the user when no run of this dashboard opened it. */
  url?: string
  /** The PR number (`pr` only). */
  number?: number
  /** The question's id (`awaiting` only) — its stable identity, so it notifies exactly once. */
  awaitId?: string
  /** Which run this is about (every kind but a `pr` opened outside this dashboard's runs): a project has several agents. */
  agentId?: string
  /** The branch the work is sitting on (`uncommitted` and `unpushed` only). */
  branch?: string
  /** How many commits are waiting (`unpushed` only). */
  commits?: number
  /** Whether the project can open a pull request (`unpushed` only): the work's next step is one, else a push. */
  gitHost?: boolean
  /** How many files were left uncommitted (`uncommitted` only). */
  files?: number
  /** When the PR was opened (`pr`) or the agent last updated (the other two), ISO, for ordering. */
  createdAt?: string
  /** The computer the run it is about runs on, when that is one of the person's other computers: the saved machine's name and kind, and its id, which the run is opened on. */
  computer?: { name: string; kind: MachineKind; id?: string }
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
  /** The questions Claude Code web sessions are parked on, as the browser bridge holds them, minus those with an answer on its way (default: the daemon's bridge store, #1554). */
  bridged?: () => BridgeQuestion[]
}

/** The bridge store's questions still waiting for a pick. */
function unansweredBridgeQuestions(): BridgeQuestion[] {
  const store = bridgeQuestions()
  return store.list().filter(question => !store.pendingAnswer(question.sessionId))
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
  // Every project at once, and each one's sources at once: a project's open requests are a git host
  // read, and asking them one project after the other kept the queue waiting seconds.
  const bridged = (deps.bridged ?? unansweredBridgeQuestions)()
  const read = await Promise.all(projects.map(project => projectInterventions(project, deps, bridged)))
  const items = read.flatMap(project => project.items)
  const whole = read.flatMap(project => (project.whole ? [project.id] : []))
  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  // The same repo can be registered under two projects (e.g. a monorepo root + a subdir), so a
  // PR would otherwise appear once per entry. Collapse by identity, keeping the first (newest-sorted).
  // A web session's question is one too: both entries share the repository's records, so each finds
  // the run that asked it.
  const seen = new Set<string>()
  const identity = (item: Intervention) => (item.awaitId?.startsWith('bridge:') ? item.awaitId : interventionKey(item))
  const unique = items.filter(item => (seen.has(identity(item)) ? false : (seen.add(identity(item)), true)))
  return { items: unique, whole }
}

/** One project's items, and whether every one of its sources answered. */
async function projectInterventions(project: ProjectSummary, deps: InterventionsDeps, bridged: BridgeQuestion[]): Promise<{ id: string; items: Intervention[]; whole: boolean }> {
  const prs = deps.prs ?? cachedOpenPrs
  const liveAgents = deps.liveAgents ?? readLiveMetas
  const events = deps.events ?? loadAgentEvents
  // A project is read whole only when every one of its sources answered. Each `unread()` below is
  // a source that did not, and contributed nothing for a reason other than nothing being there.
  let sawEverything = true
  const unread = () => {
    sawEverything = false
    return []
  }
  // The project's runs, recorded and live, read once for every source that asks.
  const [open, recorded, live] = await Promise.all([
    prs(project.path).catch(unread),
    (deps.agents ?? listAgents)(project.path).catch(() => undefined),
    liveAgents(project.path).catch(() => undefined),
  ])
  // Newest first: a branch name reused by a later run, or a run continued on it, is that run's now.
  const runs = [...(live ?? []), ...(recorded ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const items: Intervention[] = []
  for (const pr of open) {
    // The run that opened it, by the request its record names, else by the branch a run's record or
    // checkout names (#1774): what tells a run's draft from one opened by hand, and where a click on
    // the row goes, the conversation rather than the git host.
    const run = runs.find(agent => agent.pr?.url === pr.url) ?? (pr.headRefName !== undefined ? runs.find(agent => agent.branch === pr.headRefName) : undefined)
    // A draft opened by hand is not asking for review, so it stays off the queue. A draft on a
    // run's branch is the opposite (#1102): the agent, or cloud work adoption, opened it as a
    // draft so it does not ping reviewers, and if the queue then dropped it too, nothing
    // would tell anyone the work exists — which is the whole of #860 again.
    if (pr.isDraft && !run) continue
    items.push({
      projectId: project.id,
      projectName: project.name,
      kind: 'pr',
      number: pr.number,
      title: (run && runName(run)) ?? pr.title,
      url: pr.url,
      ...(run ? { agentId: run.id } : {}),
      ...(pr.createdAt ? { createdAt: pr.createdAt } : {}),
    })
  }
  // A run that ended on a question waits for the user, a "needs you" too (#636): it ended
  // `waiting`, its checkout kept for the answer (#1774). The question is read off the run's own
  // diary by the rule the run page uses, so the ping names the question
  // they offer; a waiting run whose diary shows none is skipped. A project has several runs
  // (#736), so each waiting run contributes its own item — keyed on the question's id, plus the
  // agent id so two runs are told apart.
  if (live === undefined) unread()
  const awaiting = await Promise.all(
    (live ?? [])
      .filter(meta => meta.status === 'waiting')
      .map(async meta => {
        const choice = pendingChoices((await events(project.path, meta.id).catch(() => undefined)) ?? []).at(-1)
        return choice ? [askedBy(project, meta, choice, meta.updatedAt)] : []
      }),
  )
  items.push(...awaiting.flat())
  // A Claude Code web session's question lives in the bridge store, not its log (#1554): joined on
  // the cloud session its run's record names. Waiting since the bridge saw it, not since the hand-off.
  for (const question of bridged) {
    const run = runs.find(agent => agent.target === 'web' && agent.sessionId === question.sessionId)
    if (run) items.push(askedBy(project, run, bridgeChoiceRequest(question), question.receivedAt))
  }
  // A finished run whose work never left the machine is a "needs you" too (#860). Until then the
  // queue only knew about a PR that is *already on the git host* and an agent parked on a gate, so an agent
  // that committed real code and stopped produced neither, and nothing told anyone: the overview
  // drops it (it filters on `running`) and the handoff panel is behind clicking into that agent.
  //
  // Surfacing only: this says there is a decision waiting, it does not take it. A run publishes
  // nothing by itself, so every finished run with work of its own reaches here until a person
  // publishes it, or the agent does on their ask.
  if (recorded === undefined) unread()
  items.push(...(await unpushedFor(project, recorded ?? [], deps.branches ?? projectBranches, unread)))
  return { id: project.id, items, whole: sawEverything }
}

/** A run waiting on its question, named as every list names it, the question beside it. */
function askedBy(project: ProjectSummary, run: AgentMeta, choice: ChoiceRequest, since: string | undefined): Intervention {
  return {
    projectId: project.id,
    projectName: project.name,
    kind: 'awaiting',
    title: runName(run) ?? run.id,
    question: choice.title,
    awaitId: choice.id,
    agentId: run.id,
    ...(since ? { createdAt: since } : {}),
  }
}

/**
 * The finished runs of a project whose work never left this machine (#860), as
 * {@link unpublishedRuns} finds them for the list of runs too: files left uncommitted first, since
 * committing them is the run's next step, else commits never pushed. The provider answers git
 * facts only, so the git host PR lookup the handoff summary makes per branch is never paid here: an
 * open PR means the branch was pushed, and the `pr` kind above is what surfaces it.
 */
async function unpushedFor(project: ProjectSummary, agents: AgentMeta[], branches: BranchesFor, unread: () => void): Promise<Intervention[]> {
  let found: Map<string, Unpublished>
  try {
    found = await unpublishedRuns(project.path, agents, branches)
  } catch {
    unread()
    return []
  }
  return agents.flatMap(agent => {
    const work = found.get(agent.id)
    if (!work) return []
    const left = work.uncommitted > 0 ? { kind: 'uncommitted' as const, files: work.uncommitted } : { kind: 'unpushed' as const, commits: work.commits, gitHost: project.gitHost }
    return [
      {
        projectId: project.id,
        projectName: project.name,
        ...left,
        title: runName(agent) ?? work.branch,
        agentId: agent.id,
        branch: work.branch,
        ...(agent.updatedAt ? { createdAt: agent.updatedAt } : {}),
      },
    ]
  })
}

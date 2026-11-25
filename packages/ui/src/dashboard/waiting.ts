import type { Attention, Hooks, ProjectRun, WaitingRun } from '@openagt/hooks'
import { checkoutsFirst, listAgents, loadAgentEvents, readLiveMetas, type LiveAgent, type AgentMeta } from '../store/index.js'
import { pendingChoices } from '../open-choices.js'
import type { OpenAgentEvent } from '../events.js'
import type { ProjectSummary, ProjectionRead } from './projects.js'
import { projectBranches, type BranchesFor } from '../store/branches.js'
import { unpublishedRuns, type Unpublished } from './unpublished.js'
import { pullRequestsRead, requestedBranches } from './pr-states.js'
import { waitingKey } from './keys.js'
import { needsWord } from './waiting-words.js'
import { runName } from '../run-name.js'
import { withStartedNames } from '@openagt/agent-driver'
import { distributionHooks, projectRefAt } from '../distribution-hooks.js'
import { SESSIONS_ID } from '../project-address.js'


// Pure identity + diff, in the leaf `keys.ts` so the dashboard shares them rather than copying.
export { waitingKey } from './keys.js'

// What waits on the person (#632, #2394), across the projects: the `waiting` items of
// `app.attention`, every module's (a run waiting on the question it ended on is ask's), asked with
// the project's runs that wait, and the ones the shell still finds itself until their modules say
// them (#2394's step 6): the open pull requests (github's), a finished run's work never published
// (git-branches'). Each is said in the
// hook's shape, by the module it is whose, so no reader tells the two apart. #627 notifications
// ride this whole set.

/**
 * One thing waiting on the person, as every list of them shows it (the Human Queue, a project's
 * "Waiting on you", the sidebar, the notifications): a `waiting` item of `app.attention`, with the
 * project it is in.
 */
export interface Waiting extends Attention {
  kind: 'waiting'
  projectId: string
  projectName: string
}

/** Injectable seam so {@link buildWaiting} is unit-testable off disk. */
export interface WaitingDeps {
  /** The reader of the runs that have a checkout (default {@link readLiveMetas}): a waiting run keeps its own; the runs the modules are asked about (#636). */
  liveAgents?: (cwd: string) => Promise<LiveAgent[]>
  /** One run's events, by the project's path and the run's id (default {@link loadAgentEvents}): where a waiting run's questions are read. */
  events?: (cwd: string, agentId: string) => Promise<OpenAgentEvent[] | undefined>
  /** The finished-agent reader (default {@link listAgents}); drives the work never published (#860). */
  agents?: (cwd: string) => Promise<AgentMeta[]>
  /** The project's checkouts and branches (default the project's provider, {@link projectBranches}): where a branch's state is read (#860). */
  branches?: BranchesFor
  /** The modules whose `app.attention` is asked (default the distribution's). */
  hooks?: () => Promise<Hooks>
}

/**
 * What waits on the person in every registered project, newest first. Forgiving: a project with
 * no remote (or an unreadable one) simply contributes nothing. Hand-opened draft PRs are excluded:
 * they are not yet asking for review. A draft on an agent's branch is not (#1102): an agent
 * publishes a draft when a person should look first.
 *
 * Which projects were read whole comes back alongside the items (#1623): forgiveness here is what
 * lets one unreachable project keep the list useful, and it is also what would let that project's
 * whole backlog announce itself as new the moment it came back. The lists ignore this; the
 * notification watcher is the caller that cannot.
 */
export async function buildWaiting(projects: ProjectSummary[], deps: WaitingDeps = {}, sessions?: string): Promise<ProjectionRead<Waiting>> {
  // Every project at once, and each one's sources at once: a project's open requests are a git host
  // read, and asking them one project after the other kept the list waiting seconds.
  const hooks = await (deps.hooks ?? distributionHooks)()
  const read = await Promise.all([...projects.map(project => projectWaiting(project, deps, hooks)), ...(sessions !== undefined ? [sessionsWaiting(sessions, deps, hooks)] : [])])
  const items = read.flatMap(project => project.items)
  const whole = read.flatMap(project => (project.whole ? [project.id] : []))
  items.sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''))
  // The same repo can be registered under two projects (e.g. a monorepo root + a subdir), so a
  // PR would otherwise appear once per entry, and so would what waits on a run: both entries share
  // the repository's records, so each finds the run. Collapse by identity, keeping the first (newest-sorted).
  const seen = new Set<string>()
  // An item named by an address (a pull request's) is one thing in every project it is listed in.
  const identity = (item: Waiting) => (item.id !== undefined && /^https?:\/\//.test(item.id) ? `${item.module}:${item.id}` : item.scope === 'run' ? `${item.module}:run:${item.run ?? ''}:${item.id ?? ''}` : waitingKey(item))
  const unique = items.filter(item => (seen.has(identity(item)) ? false : (seen.add(identity(item)), true)))
  return { items: oneStepPerRun(unique), whole }
}

/** A run's steps, the first one first: its question answered, its files committed, its work published, its pull request merged. */
const STEP_ORDER: readonly (Waiting['mark'] | undefined)[] = ['question', 'changes', 'branch', 'pull-request']

/**
 * What waits on one run is one item: its next step. A run can wait on two at once, its pull request
 * open and files left uncommitted after it, and each list showed one of them or both: the sidebar
 * drew the run twice, and a notification said "Needs commit" of the run its row said "Needs merge"
 * of. An item of a step this list does not know comes after every known one. The order stays the
 * list's.
 */
function oneStepPerRun(items: Waiting[]): Waiting[] {
  const rank = (item: Waiting) => {
    const at = STEP_ORDER.indexOf(item.mark)
    return at === -1 ? STEP_ORDER.length : at
  }
  const next = new Map<string, Waiting>()
  for (const item of items) {
    if (item.scope !== 'run' || item.run === undefined) continue
    const kept = next.get(item.run)
    if (kept === undefined || rank(item) < rank(kept)) next.set(item.run, item)
  }
  return items.filter(item => item.scope !== 'run' || item.run === undefined || next.get(item.run) === item)
}

/** One project's items, and whether every one of its sources answered. */
async function projectWaiting(project: ProjectSummary, deps: WaitingDeps, hooks: Hooks): Promise<{ id: string; items: Waiting[]; whole: boolean }> {
  const liveAgents = deps.liveAgents ?? readLiveMetas
  const events = deps.events ?? loadAgentEvents
  // A project is read whole only when every one of its sources answered. Each `unread()` below is
  // a source that did not, and contributed nothing for a reason other than nothing being there.
  let sawEverything = true
  const unread = () => {
    sawEverything = false
    return []
  }
  const inProject = { projectId: project.id, projectName: project.name }
  // The project's runs, recorded and live, read once for every source that asks; a just-started run by the sidebar's name.
  const liveRead = liveAgents(project.path)
    .then(agents => withStartedNames(agents))
    .catch(() => undefined)
  const recordedRead = (deps.agents ?? listAgents)(project.path)
    .then(agents => withStartedNames(agents))
    .catch(() => undefined)
  // Newest first: a branch name reused by a later run, or a run continued on it, is that run's now.
  const runs = async (): Promise<ProjectRun[]> =>
    [...((await liveRead) ?? []), ...((await recordedRead) ?? [])]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(run => ({ id: run.id, ...(runName(run) !== undefined ? { name: runName(run)! } : {}), ...(run.branch !== undefined ? { branch: run.branch } : {}), ...(run.pr ? { pr: run.pr } : {}) }))
  const [recorded, live, modules] = await Promise.all([recordedRead, liveRead, modulesWaiting(project, hooks, () => waitingRuns(project, liveRead, events), runs)])
  if (!modules.whole) unread()
  const items: Waiting[] = modules.items.map(item => ({ ...item, ...inProject }))
  if (live === undefined) unread()
  // A finished run whose work never left the machine is a "needs you" too (#860). Until then the
  // list only knew about a PR that is *already on the git host* and an agent parked on a gate, so an agent
  // that committed real code and stopped produced neither, and nothing told anyone: the overview
  // drops it (it filters on `running`) and the handoff panel is behind clicking into that agent.
  //
  // Surfacing only: this says there is a decision waiting, it does not take it. A run publishes
  // nothing by itself, so every finished run with work of its own reaches here until a person
  // publishes it, or the agent does on their ask.
  if (recorded === undefined) unread()
  // A branch with an open request is published, as the modules read the requests just now; where
  // one of them could not say, a pushed branch is not counted.
  const requested = project.gitHost && modules.whole ? requestedBranches() : undefined
  // A run continued in its checkout works again, whatever its record says of its first leg (#768).
  items.push(...(await unpushedFor(project, checkoutsFirst(live ?? [], recorded ?? []), deps.branches ?? projectBranches, unread, requested)))
  return { id: project.id, items, whole: sawEverything }
}

/**
 * What waits on the person in the sessions with no project, whose home is `home`: what the modules
 * say of the ones that wait, as a session's question. They are in no project's list, so nothing
 * said they waited: not "Waiting on you", not its count, not a notification. A session has no
 * branch of the project's and no pull request the shell finds, so the modules are all that is asked.
 */
async function sessionsWaiting(home: string, deps: WaitingDeps, hooks: Hooks): Promise<{ id: string; items: Waiting[]; whole: boolean }> {
  const live = (deps.liveAgents ?? readLiveMetas)(home)
    .then(agents => withStartedNames(agents))
    .catch(() => undefined)
  const sessions = { id: SESSIONS_ID, name: 'the sessions with no project', path: home }
  const modules = await modulesWaiting(undefined, hooks, () => waitingRuns(sessions, live, deps.events ?? loadAgentEvents))
  return { id: SESSIONS_ID, items: modules.items.map(item => ({ ...item, projectId: SESSIONS_ID, projectName: '' })), whole: modules.whole && (await live) !== undefined }
}

/** What the modules on in the project say waits on the person there, given its runs that wait; asked only of a distribution where one says anything. No project: the sessions that have none. */
async function modulesWaiting(project: ProjectSummary | undefined, hooks: Hooks, waiting: () => Promise<WaitingRun[]>, runs?: () => Promise<ProjectRun[]>): Promise<{ items: (Attention & { kind: 'waiting' })[]; whole: boolean }> {
  if (!hooks.modules.some(module => module.hooks['app.attention'])) return { items: [], whole: true }
  try {
    const read = await hooks.attention({ ...(project ? { project: await projectRefAt(project.id, project.path) } : {}), waiting, ...(runs ? { runs } : {}), pullRequestsRead })
    return { items: read.items.filter((item): item is Attention & { kind: 'waiting' } => item.kind === 'waiting'), whole: read.whole }
  } catch {
    return { items: [], whole: false }
  }
}

/**
 * The project's runs that ended waiting, newest first, each with the questions it still waits on,
 * read off its own diary by the rule the run page uses (#636): a waiting run keeps its checkout
 * for the answer (#1774), so the runs that have one are the ones read. A run whose diary cannot be
 * read waits on no question it can be asked. Throws when the runs could not be read at all.
 */
async function waitingRuns(project: Pick<ProjectSummary, 'name' | 'path'>, live: Promise<LiveAgent[] | undefined>, events: NonNullable<WaitingDeps['events']>): Promise<WaitingRun[]> {
  const runs = await live
  if (runs === undefined) throw new Error(`the runs of ${project.name} could not be read`)
  const waiting = runs.filter(meta => meta.status === 'waiting').sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return Promise.all(
    waiting.map(async (meta): Promise<WaitingRun> => {
      const questions = pendingChoices((await events(project.path, meta.id).catch(() => undefined)) ?? [])
      const name = runName(meta)
      const endedAt = meta.endedAt ?? meta.updatedAt
      return { id: meta.id, ...(name !== undefined ? { name } : {}), ...(endedAt ? { endedAt } : {}), questions: questions.map(question => ({ ...question, options: [...question.options] })) }
    }),
  )
}

/**
 * The finished runs of a project whose work never left this machine (#860), as
 * {@link unpublishedRuns} finds them for the list of runs too: files left uncommitted first, since
 * committing them is the run's next step, else commits never pushed. The provider answers git
 * facts only, so the git host PR lookup the handoff summary makes per branch is never paid here: an
 * open PR means the branch was pushed, and the pull requests above are what surface it. `requested`
 * is the branches of those open PRs, from the same cached read, where the project has a git host.
 */
async function unpushedFor(project: ProjectSummary, agents: AgentMeta[], branches: BranchesFor, unread: () => void, requested: ReadonlySet<string | undefined> | undefined): Promise<Waiting[]> {
  let found: Map<string, Unpublished>
  try {
    found = await unpublishedRuns(project.path, agents, branches, requested && (async () => requested))
  } catch {
    unread()
    return []
  }
  return agents.flatMap((agent): Waiting[] => {
    const work = found.get(agent.id)
    if (!work) return []
    // Committing the files is a new step from publishing them, and is said anew once they are.
    const left =
      work.uncommitted > 0
        ? { id: `uncommitted:${agent.id}`, words: needsWord('uncommitted'), detail: work.uncommitted === 1 ? '1 file' : `${work.uncommitted} files`, mark: 'changes' as const }
        : // An unknown count says nothing rather than the contradictory "0 commits".
          { id: `unpushed:${agent.id}`, words: needsWord('unpushed', project.gitHost), ...(work.commits ? { detail: work.commits === 1 ? '1 commit' : `${work.commits} commits` } : {}), mark: 'branch' as const }
    return [
      {
        kind: 'waiting',
        module: 'git-branches',
        scope: 'run',
        run: agent.id,
        ...left,
        title: runName(agent) ?? work.branch,
        ...(agent.updatedAt ? { since: agent.updatedAt } : {}),
        projectId: project.id,
        projectName: project.name,
      },
    ]
  })
}

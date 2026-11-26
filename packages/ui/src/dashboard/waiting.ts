import { projectsUnder } from './projects-under.js'
import type { Attention, Hooks, WaitingRun } from '@openagt/hooks'
import { readRunEvents, type AgentMeta } from '../store/index.js'
import { contextRuns, runHostOf } from '../dashboard-rpc/context.js'
import { pendingChoices } from '../open-choices.js'
import type { RunEvent } from '@openagt/hooks'
import type { ProjectSummary, ProjectionRead } from './projects.js'
import { pullRequestsRead } from './pr-states.js'
import { waitingKey } from './keys.js'
import { runName } from '../run-name.js'
import { distributionHooks, projectRefAt } from '../distribution-hooks.js'
import { SESSIONS_ID } from '../project-address.js'


// Pure identity + diff, in the leaf `keys.ts` so the dashboard shares them rather than copying.
export { waitingKey } from './keys.js'

// What waits on the person (#632, #2394), across the projects: the `waiting` items of
// `app.attention`, every module's (a run waiting on its question, an open pull request, a run's
// work never published), asked with the project's runs that wait (the others are the app's to list,
// `AppContext.runs`). Each is said in the hook's shape, by the module it is whose. #627 notifications ride this whole set.

/**
 * One thing waiting on the person, as every list of them shows it (the Human Queue, a project's
 * "Waiting on you", the sidebar, the notifications): a `waiting` item of `app.attention`, with the
 * project it is in.
 */
export interface Waiting extends Attention {
  kind: 'waiting'
  projectId: string
  projectName: string
  /** A session with no project's: the projects it is listed under (`projects-under.ts`), by id, whose "Waiting on you" says it too. */
  under?: string[]
}

/** Injectable seam so {@link buildWaiting} is unit-testable off disk. */
export interface WaitingDeps {
  /** A project's runs, or with none the sessions with no project's, as their hosts say them (default {@link contextRuns}): the runs the modules are asked about (#636). */
  agents?: (project: ProjectSummary | undefined) => Promise<AgentMeta[]>
  /** One run's events, as its host says them (default {@link readRunEvents}): where a waiting run's questions are read. */
  events?: (project: ProjectSummary | undefined, agentId: string) => Promise<RunEvent[] | undefined>
  /** The modules whose `app.attention` is asked (default the distribution's). */
  hooks?: () => Promise<Hooks>
}

/**
 * What waits on the person in every registered project, newest first. Forgiving: a project whose
 * sources cannot be read simply contributes nothing.
 *
 * Which projects were read whole comes back alongside the items (#1623): forgiveness here is what
 * lets one unreachable project keep the list useful, and it is also what would let that project's
 * whole backlog announce itself as new the moment it came back. The lists ignore this; the
 * notification watcher is the caller that cannot.
 */
export async function buildWaiting(projects: ProjectSummary[], deps: WaitingDeps = {}, sessions?: string): Promise<ProjectionRead<Waiting>> {
  // Every project at once, and each one's sources at once: what a module reads may be a git host's,
  // and asking them one project after the other kept the list waiting seconds.
  const hooks = await (deps.hooks ?? distributionHooks)()
  const read = await Promise.all([...projects.map(project => projectWaiting(project, deps, hooks)), ...(sessions !== undefined ? [sessionsWaiting(sessions, projects, deps, hooks)] : [])])
  const items = read.flatMap(project => project.items)
  const whole = read.flatMap(project => (project.whole ? [project.id] : []))
  items.sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''))
  // The same repo can be registered under two projects (e.g. a monorepo root + a subdir), so a
  // PR would otherwise appear once per entry, and so would what waits on a run: both entries share
  // the repository's records, so each finds the run. Collapse by identity, keeping the first (newest-sorted).
  const seen = new Set<string>()
  // An item named by an address (a pull request's) is one thing in every project it is listed in.
  const identity = (item: Waiting) => (item.id !== undefined && /^https?:\/\//.test(item.id) ? `${item.module}:${item.id}` : item.scope === 'run' ? `${item.module}:run:${item.run ?? ''}:${item.id ?? ''}` : waitingKey(item))
  // Said by a run (a session's copy's request) and by its own project with none, the run's is kept: its row opens the session.
  const ofRuns = new Set(items.flatMap(item => (item.scope === 'run' ? [identity(item)] : [])))
  const unique = items.filter(item => !(item.scope !== 'run' && ofRuns.has(identity(item))) && (seen.has(identity(item)) ? false : (seen.add(identity(item)), true)))
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
  const events = deps.events ?? hostEvents
  // A project is read whole only when every one of its sources answered. Each `unread()` below is
  // a source that did not, and contributed nothing for a reason other than nothing being there.
  let sawEverything = true
  const unread = () => {
    sawEverything = false
    return []
  }
  const inProject = { projectId: project.id, projectName: project.name }
  // The project's runs, read once for every source that asks.
  const runsRead = (deps.agents ?? contextRuns)(project).catch(() => undefined)
  const [recorded, modules] = await Promise.all([runsRead, modulesWaiting(project, hooks, () => waitingRuns(project, runsRead, events))])
  if (!modules.whole) unread()
  const items: Waiting[] = modules.items.map(item => ({ ...item, ...inProject }))
  if (recorded === undefined) unread()
  return { id: project.id, items, whole: sawEverything }
}

/**
 * What waits on the person in the sessions with no project, whose home is `home`: what the modules
 * say of the ones that wait, as a session's question. They are in no project's list, so nothing
 * said they waited: not "Waiting on you", not its count, not a notification.
 */
async function sessionsWaiting(home: string, projects: readonly ProjectSummary[], deps: WaitingDeps, hooks: Hooks): Promise<{ id: string; items: Waiting[]; whole: boolean }> {
  const live = (deps.agents ?? contextRuns)(undefined).catch(() => undefined)
  const sessions = { id: SESSIONS_ID, name: 'the sessions with no project', path: home }
  const modules = await modulesWaiting(undefined, hooks, () => waitingRuns(undefined, live, deps.events ?? hostEvents, sessions.name))
  // A session that has a copy of a project waits in that project's list too.
  const runs = (await live) ?? []
  const underOf = (run: string | undefined): string[] => projectsUnder(runs.find(agent => agent.id === run), projects).map(project => project.id)
  return {
    id: SESSIONS_ID,
    items: modules.items.map(item => {
      const under = underOf(item.run)
      return { ...item, projectId: SESSIONS_ID, projectName: '', ...(under.length > 0 ? { under } : {}) }
    }),
    whole: modules.whole && (await live) !== undefined,
  }
}

/** What the modules on in the project say waits on the person there, given its runs that wait; asked only of a distribution where one says anything. No project: the sessions that have none. */
async function modulesWaiting(project: ProjectSummary | undefined, hooks: Hooks, waiting: () => Promise<WaitingRun[]>): Promise<{ items: (Attention & { kind: 'waiting' })[]; whole: boolean }> {
  if (!hooks.modules.some(module => module.hooks['app.attention'])) return { items: [], whole: true }
  try {
    const read = await hooks.attention({ ...(project ? { project: await projectRefAt(project.id, project.path) } : {}), waiting, pullRequestsRead })
    return { items: read.items.filter((item): item is Attention & { kind: 'waiting' } => item.kind === 'waiting'), whole: read.whole }
  } catch {
    return { items: [], whole: false }
  }
}

/** One run's events, as its host streams them up to what it already has. */
async function hostEvents(project: ProjectSummary | undefined, agentId: string): Promise<RunEvent[] | undefined> {
  const run = { id: agentId, ...(project ? { project: { id: project.id, name: project.name, dir: project.path } } : {}) }
  return readRunEvents(await runHostOf(run), run)
}

/**
 * The project's runs that ended waiting, newest first, each with the questions it still waits on,
 * read off its events by the rule the run page uses (#636). A run whose events cannot be read waits
 * on no question it can be asked. Throws when the runs could not be read at all.
 */
async function waitingRuns(project: ProjectSummary | undefined, read: Promise<AgentMeta[] | undefined>, events: NonNullable<WaitingDeps['events']>, name: string = project?.name ?? ''): Promise<WaitingRun[]> {
  const runs = await read
  if (runs === undefined) throw new Error(`the runs of ${name} could not be read`)
  const waiting = runs.filter(meta => meta.status === 'waiting').sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return Promise.all(
    waiting.map(async (meta): Promise<WaitingRun> => {
      const questions = pendingChoices((await events(project, meta.id).catch(() => undefined)) ?? [])
      const name = runName(meta)
      const endedAt = meta.endedAt ?? meta.updatedAt
      return { id: meta.id, ...(name !== undefined ? { name } : {}), ...(endedAt ? { endedAt } : {}), questions: questions.map(question => ({ ...question, options: [...question.options] })) }
    }),
  )
}

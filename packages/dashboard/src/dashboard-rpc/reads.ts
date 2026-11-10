import { SESSIONS_ID } from '../project-address.js'
import { stat } from 'node:fs/promises'
import { originDefaultBranch } from '@openagt/agent-data'
import { moduleAgents, type ModuleAgent, type ModuleAgentsWanted } from '../dashboard/module-agents.js'
import { join } from 'node:path'
import type { BridgeBrowserStatus } from '../bridge-browser.js'
import { findAgent, findCheckout, readLiveMetas, readDoing, loadAgentEvents, type AgentDoing, startedAtFromAgentId, type AgentMeta, isRunId, projectBranches } from '../store/index.js'
import { listProjectWorktrees } from '../worktrees.js'
import { projectGitHost, type GitHostHome } from '../store/git-host.js'
import { repositoryOffer, type RepositoryOffer } from '../store/repository.js'
import { readDocs, type WorkspaceDoc } from '../dashboard/docs.js'
import { collectQueue, type ProjectQueue } from '../dashboard/queue.js'
import { buildOverview, buildRecentAgents, type Overview, type RecentAgent } from '../dashboard/overview.js'
import { buildInterventions, type Intervention } from '../dashboard/interventions.js'
import { withMachinesQueue, type MachinesQueue } from '../dashboard/machine-interventions.js'
import type { ProjectionRead, ProjectSummary } from '../dashboard/projects.js'
import { buildActivity, type Activity } from '../dashboard/activity.js'
import { buildDashboard, type DashboardData } from '../dashboard/dashboard.js'
import { readGitStatus, type GitStatus } from '../dashboard/git-status.js'
import { readRunHandoff, resolveAgentPr, type AgentHandoff } from '../dashboard/agent-handoff.js'
import type { AgentWorktree } from '../dashboard/types.js'
import { crawlRepoFiles } from '../project.js'
import { contextBridgeBrowser, contextProjects, contextRemote, resolveProjectPath, resolveAgentPath } from './context.js'
import { relayOr } from './relay-agent.js'
import type { OpenAgentEvent } from '../events.js'
import { bridgeQuestions } from '../dashboard/bridge-store.js'
import { isCloudSessionId, type BridgeEvent, type BridgeHello, type BridgeQuestion } from '../dashboard/bridge-endpoints.js'
import type { BridgeAnswer, BridgeContact, BridgeVersion } from '../dashboard/bridge-store.js'
import { readBridgeToken, readPreferences } from '../registry.js'
import { hostname } from 'node:os'
import { RUNS_WAIT_MS, RunChanges, withMachineRuns, type MachineRuns, type OwnRuns } from '../dashboard/machine-runs.js'
import { ownRunsWatch } from '../dashboard/runs-watch.js'
import { startedName, withStartedNames } from '../started-names.js'
import { isElsewhereId } from '../dashboard/elsewhere.js'
import { asRecorded, forDashboard, markMachine, recordedRuns, withFollowed, withRowMarks } from '../dashboard/run-rows.js'

// The read model behind the dashboard (#405): the agent history, an agent's replay, and the
// surfaced PLAN/TODO docs — each keyed by project id and backed by
// the readers that own those files, so the dashboard stays a projection of the same files. They live beside the daemon rather than in the
// browser's own tree so it can serve them in-process; the dashboard calls them by name over
// `POST /_rpc/<name>`. The live agent stream is its own endpoint (`GET /_rpc/events`).

/** Run a cross-project rollup over every registered project, tolerating a failed registry read. */
async function withProjects<T>(build: (projects: ProjectSummary[]) => Promise<T>): Promise<T> {
  const projects = await contextProjects().list().catch(() => [])
  return build(projects)
}

/**
 * The project's runs, most-recent first (or `[]`). The archived (finished) runs
 * from `agents/`, plus every live agent prepended — so the sidebar shows an in-progress
 * run with a `running` status the moment it starts, not only after it closes.
 *
 * Since #736 a project has any number of live agents, each in its own worktree, so this reads
 * them all (#738) instead of the single one that used to sit at the project path. They come
 * back as {@link LiveAgent}s, carrying the `cwd` of the checkout that agent is editing.
 *
 * One row per id, and where both a live and an archived copy exist the live one wins (#768): a
 * continued run (#762) has an archive from its first leg while being live again, and the archive
 * would otherwise show a running agent as finished. The status is not filtered on: `readLiveMeta`
 * may have just self-healed a dead agent to `stopped` (#716), and that freshly-archived row can
 * lag `listAgents` by a poll — keeping it regardless leaves the row visible with no flicker.
 *
 * An agent relayed to a saved machine (#1067) lives only in the daemon's memory, never on disk, so
 * its in-memory stub is merged in too (#1077): that is what re-opens it after a dashboard reload
 * instead of losing it.
 */
export async function onAgents(projectId: string): Promise<AgentMeta[]> {
  return runRows(projectId, await resolveProjectPath(projectId))
}

/**
 * The name asked for a run just started, answered once it is in (`started-names.ts`): the run's
 * row is not in the list yet when it is, and the page shows it where the row will be. A run that
 * runs on a saved machine was named there, so the machine is asked. Nothing when no name came.
 */
export async function onStartedName(projectId: string, agentId: string): Promise<string | undefined> {
  return relayOr(agentId, 'onStartedName', [projectId, agentId], () => startedName(agentId), undefined)
}

/** A project's runs as its list shows them: off its folder here (`cwd`), else as the computer it is on says them. */
async function runRows(projectId: string, cwd: string | undefined): Promise<AgentMeta[]> {
  // The relayed-agent stubs (#1077): a run this daemon follows on a machine lives in its memory only.
  const remote = contextRemote().list(projectId)
  const machineOf = await contextRemote().machineNames()
  const local = cwd ? withStartedNames(await withRowMarks(cwd, (await listedRuns(cwd)).map(agent => forDashboard(agent, machineOf)))) : isElsewhereId(projectId) ? (await elsewhereRuns(projectId)).map(agent => forDashboard(agent, machineOf)) : []
  return withFollowed(remote, local, agentId => contextRemote().sent(agentId))
}

/** The runs of another computer's project (elsewhere.ts), as that computer says them: there are no records of them here. */
function elsewhereRuns(projectId: string): Promise<AgentMeta[]> {
  return saidByMachines(contextRemote().elsewhereRuns(projectId))
}

/** The runs the saved machines say they run, as recorded: one a machine that does not answer runs is not known to go on. */
async function saidByMachines(asked: Promise<MachineRuns[]>): Promise<AgentMeta[]> {
  const machines = await asked.catch((): MachineRuns[] => [])
  return withMachineRuns([], machines.map(machine => ({ ...machine, runs: machine.runs.map(asRecorded) })))
}

/**
 * A project's runs as a module sees them ({@link ModuleAgent}), only the ones it asks for: a card
 * shows a few of the hundreds a project keeps, and each run in the few fields a module reads, so
 * what a phone downloads for it is that much smaller. The same runs as {@link onAgents}.
 */
export async function onModuleAgents(projectId: string, wanted: ModuleAgentsWanted = {}): Promise<ModuleAgent[]> {
  return moduleAgents(await onAgents(projectId), wanted)
}

/**
 * A project's runs as the dashboard lists them: its records, with what each saved machine says of
 * its own runs right now taking over theirs (machine-runs.ts). Not marked yet for the dashboard.
 */
async function listedRuns(cwd: string): Promise<AgentMeta[]> {
  const [records, machines] = await Promise.all([recordedRuns(cwd), contextRemote().machineRuns(cwd).catch((): MachineRuns[] => [])])
  return withMachineRuns(records, machines.map(machine => ({ ...machine, runs: machine.runs.map(asRecorded) })))
}

/** What this computer's own runs answer to another computer that asks for them: counted per project, as they change. */
const ownRunChanges = new RunChanges()

/**
 * This computer's own runs of a project, for another computer that lists them (machine-runs.ts):
 * the ones that changed since `since`, the answer it had last, as they stand right now. Only this
 * computer's: what another computer's records say is that computer's to answer. With `wait` (ms,
 * up to {@link RUNS_WAIT_MS}) and no change a list shows since `since`, the answer waits for the
 * first such change, or says what changed otherwise once the wait is up.
 */
export async function onOwnRuns(projectId: string, since?: unknown, wait?: unknown): Promise<OwnRuns> {
  const cwd = await resolveProjectPath(projectId)
  const thisHost = hostname()
  const answer = async (): Promise<OwnRuns> => ownRunChanges.answer(cwd ?? projectId, cwd ? (await recordedRuns(cwd)).filter(run => run.host === thisHost) : [], since)
  if (cwd === undefined || typeof wait !== 'number' || !(wait > 0)) return answer()
  // Listened to before the runs are read: a change while they are read is a change all the same.
  let changed = false
  let woken: (() => void) | undefined
  const stop = ownRunsWatch.follow(cwd, () => {
    changed = true
    woken?.()
  })
  try {
    const now = await answer()
    // A step of a run (its later time, its cost) is no change a list shows: it waits for one, and goes with it.
    if (changed || ownRunChanges.shownSince(cwd, since)) return now
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, Math.min(wait, RUNS_WAIT_MS))
      woken = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    return await answer()
  } finally {
    stop()
  }
}

/**
 * The agent ids that still have a worktree on disk (#737). An agent that failed or was stopped keeps
 * its checkout so you can go look at what it was holding; this is how the dashboard knows which
 * finished run has one to offer removing. Live agents are excluded — their worktree is in use.
 */
export async function onRetainedWorktrees(projectId: string): Promise<string[]> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  const rows = await listProjectWorktrees(cwd, { sizes: false }).catch((): never[] => [])
  return rows.filter(row => !row.live).map(row => row.agentId)
}

/**
 * Where a session is working (#798): the checkout it has, its branch, whether it is holding
 * uncommitted changes, and — once it is no longer live — what that checkout costs on disk.
 *
 * The dashboard could not answer "where is this session working". The git status bar reads the
 * *project*, so a session's own branch was visible nowhere, and a worktree an agent kept (#737) was
 * a name in a list with no size and no way in.
 *
 * Every run works in a checkout of its own, so once that checkout is gone there is no tree left to
 * be clean or dirty: the answer is then only what the run recorded, its branch and its pull
 * request. It used to fall back to the project's root and report the user's own checkout (their
 * branch, their "clean") as the run's.
 */
export async function onAgentWorktree(projectId: string, agentId: string): Promise<AgentWorktree | null> {
  return relayOr(agentId, 'onAgentWorktree', [projectId, agentId], async () => {
    const root = await resolveProjectPath(projectId)
    if (!root || !isRunId(agentId)) return null
    const checkout = await findCheckout(root, agentId, projectBranches)
    // Since-filtered like every run-scoped PR read (#1255): the checkout's branch is the agent's,
    // but a reused pinned branch has a predecessor's PR history.
    const since = startedAtFromAgentId(agentId)
    // Read only while the checkout's own `.git` is there: without it git reads the project's
    // checkout the run's folder sits in, and answered with the person's branch as the run's.
    const linked = checkout ? await stat(join(checkout.path, '.git')).then(() => true, () => false) : false
    const [status, live] = checkout && linked
      ? await Promise.all([
          readGitStatus(checkout.path, { prRoot: root, ...(since !== undefined ? { since } : {}) }).catch(() => undefined),
          readLiveMetas(root).catch(() => []),
        ])
      : [undefined, []]
    if (!checkout || !status) {
      // The checkout's branch was the agent's; with no checkout the record is the only witness. So
      // it is for a checkout git cannot read: the run's clean-up is removing it, and an answer
      // without its branch put the bar above the message box away until the next read.
      const agent = await findAgent(root, agentId).catch(() => undefined)
      if (!agent) return null
      const pr = await resolveAgentPr(root, agent).catch(() => ({ value: undefined, pending: false }))
      return {
        ...(agent.branch ? { branch: agent.branch } : {}),
        ...(pr.value ? { pr: pr.value } : {}),
        ...(pr.pending ? { prPending: true } : {}),
      }
    }
    // Size is only read for a checkout nothing is writing to: a live agent's tree changes under the
    // poll, and a size over a build directory mid-build is a cost with no answer worth having. The
    // provider's sized listing is where a checkout's size comes from (#1774).
    const running = live.some(agent => agent.id === agentId && agent.status === 'running')
    const size = running ? undefined : (await (await projectBranches(root).catch(() => undefined))?.list({ sizes: true }).catch(() => []))?.find(row => row.id === agentId)?.sizeBytes
    return {
      checkout: { path: checkout.path, dirty: status.dirty, ...(size !== undefined ? { sizeBytes: size } : {}) },
      branch: status.branch,
      // A session's branch is exactly the thing that has a PR (#809), so the bar can show it
      // like the project's does.
      ...(status.pr ? { pr: status.pr } : {}),
      // Still being looked up rather than absent (#1028), so the bar can ask again shortly.
      ...(status.prPending ? { prPending: true } : {}),
    }
  }, null)
}

/** One archived agent's event log for replay (or `[]` when the agent or project is gone). */
export async function onAgent(projectId: string, agentId: string): Promise<OpenAgentEvent[]> {
  return relayOr(agentId, 'onAgent', [projectId, agentId], async () => {
    const cwd = await resolveProjectPath(projectId)
    if (!cwd) return []
    return (await loadAgentEvents(cwd, agentId).catch(() => undefined)) ?? []
  }, [])
}

/** What each of the named runs of a project is doing now, by id; a run that is not working has no entry. */
export async function onAgentsDoing(projectId: string, agentIds: string[]): Promise<Record<string, AgentDoing>> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return {}
  return readDoing(cwd, agentIds).catch(() => ({}))
}

/** The surfaced PLAN/TODO docs at the workspace root, in sidebar order (or `[]`). */
export async function onDocs(projectId: string): Promise<WorkspaceDoc[]> {
  const cwd = await resolveProjectPath(projectId)
  return cwd ? readDocs(cwd).catch(() => []) : []
}

/** The aggregated open TODO queue across every registered project (#438), most-open first. */
export async function onQueue(): Promise<ProjectQueue[]> {
  return withProjects(collectQueue)
}

/** The cross-project Overview (#437): what is running now, the queue size, and recent projects. */
export async function onOverview(): Promise<Overview> {
  // The runs going on the person's other computers too, of a project here and of one only they have.
  const remote = contextRemote()
  const [machineOf, elsewhere] = await Promise.all([remote.machineNames(), remote.elsewhere().catch((): ProjectSummary[] => [])])
  return withProjects(projects =>
    buildOverview([...projects, ...elsewhere], {
      machineRuns: async project =>
        (await saidByMachines(project.machine === undefined ? remote.machineRuns(project.path) : remote.elsewhereRuns(project.id))).map(agent => markMachine(agent, machineOf)),
    }),
  )
}

/** Recent sessions pooled across every project and the sessions with no project (#shared-shell), newest first, for the home rail. */
export async function onRecentAgents(): Promise<RecentAgent[]> {
  // Each project's runs as its own list shows them, the projects only the person's other computers have too.
  const elsewhere = await contextRemote()
    .elsewhere()
    .catch((): ProjectSummary[] => [])
  return withProjects(projects =>
    buildRecentAgents([...projects, ...elsewhere], {
      agents: project => runRows(project.id, project.machine === undefined ? project.path : undefined),
      sessions: async () => runRows(SESSIONS_ID, await resolveProjectPath(SESSIONS_ID)),
    }),
  )
}


/**
 * The cross-project interventions queue (#632, Queue #624): open PRs that need review, newest first,
 * plus which projects were read whole (#1625).
 *
 * The panels render `items` and ignore the rest. The browser's notifier is the caller that cannot:
 * it keeps a baseline of what was already waiting when the page opened, and a queue that came back
 * empty because the git host was unreachable is not a baseline — taking it for one announces the whole
 * backlog the moment the git host answers.
 */
export async function onInterventions(): Promise<ProjectionRead<Intervention>> {
  // What needs the person on their other computers too: a run's question there, the PRs of a project only they have.
  const remote = contextRemote()
  const [own, machines, elsewhere] = await Promise.all([
    withProjects(projects => buildInterventions(projects).then(read => ({ read, projects }))),
    remote.machinesQueue().catch((): MachinesQueue => ({ said: [], unread: [] })),
    remote.elsewhere().catch((): ProjectSummary[] => []),
  ])
  return withMachinesQueue(own.read, machines, new Map([...own.projects, ...elsewhere].map(project => [project.id, project.name])))
}

/**
 * This computer's own Human Queue, for another computer of the person's that shows it beside its
 * own (machine-interventions.ts): the items of this computer's projects only, never of the
 * projects it lists of other computers, so no computer asks back the one that asked it.
 */
export async function onOwnInterventions(): Promise<ProjectionRead<Intervention>> {
  return withProjects(buildInterventions)
}

/**
 * The cross-project "New activity" feed (#627): recent run started/finished transitions, newest
 * first, with the projects that were read whole beside them (#1625) — see {@link onInterventions}.
 */
export async function onActivity(): Promise<ProjectionRead<Activity>> {
  // Another computer's runs start and end by its own word, as the lists show them, and so do the
  // runs of a project only another computer has.
  const elsewhere = await contextRemote()
    .elsewhere()
    .catch((): ProjectSummary[] => [])
  return withProjects(projects => buildActivity([...projects, ...elsewhere], { readAgents: project => (project.machine === undefined ? listedRuns(project.path) : elsewhereRuns(project.id)) }))
}

/** The Overview dashboard page (#471): the {@link onOverview} rollup plus agent counts, run-status totals, and activity. */
export async function onDashboard(): Promise<DashboardData> {
  const projects = await contextProjects().list().catch(() => [])
  const of = projects.map(project => project.path).join('\n')
  const building = (buildingDashboard ??= buildDashboard(projects)
    .then(view => ((lastDashboard = { of, view }), view))
    .finally(() => (buildingDashboard = undefined)))
  if (lastDashboard?.of !== of) return building
  // Its answer is for the next ask; a build that failed leaves the last answer standing.
  building.catch(() => undefined)
  return lastDashboard.view
}

/**
 * The Overview's summary as last built, and the build under way: it reads every project's queue and
 * tickets through their packages, a second and more on a small server, so a page is answered at
 * once with the last summary for the same projects while it is built again behind it.
 */
let lastDashboard: { of: string; view: DashboardData } | undefined
let buildingDashboard: Promise<DashboardData> | undefined

/**
 * The project's files for the `#` context picker (#504) and the Context's file count (#661): every
 * file git sees (tracked + untracked, honoring .gitignore), repo-relative and sorted, via
 * `git ls-files`; `[]` for a project with no folder here.
 * Pass a live `agentId` to list that agent's worktree instead of the project root (#738). The
 * Files pane reads its own list, through its module.
 */
export async function onProjectFiles(projectId: string, agentId?: string): Promise<string[]> {
  return relayOr(agentId, 'onProjectFiles', [projectId, agentId], async () => {
    // The checkout `agentId` names: its own while the run is live, else the project's root (#738).
    const cwd = await resolveAgentPath(projectId, agentId)
    return cwd ? crawlRepoFiles(cwd).catch(() => []) : []
  }, [])
}

/**
 * The name of origin's default branch on the computer a run is on: what a run that made its own
 * branch and was told no other started from, read by the rule the start itself goes by. Null for a
 * clone with none: such a run started from whatever was checked out, which nobody wrote down.
 */
export async function onAgentMainBranch(projectId: string, agentId: string): Promise<string | null> {
  return relayOr(agentId, 'onAgentMainBranch', [projectId, agentId], async () => {
    const root = await resolveProjectPath(projectId)
    if (!root) return null
    const main = await originDefaultBranch(root).catch(() => undefined)
    return main?.slice('origin/'.length) ?? null
  }, null)
}

/** The project's page on its git host and the git host's name (#489, #1820), or null: no git host package, or no remote there. */
export async function onGitHostHome(projectId: string): Promise<GitHostHome | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const gitHost = await projectGitHost(cwd).catch(() => undefined)
  return (await gitHost?.home()) ?? null
}

/** The repository the project's provider offers to create for it (a project with no remote), or null: no provider, a remote already there, or the host out of reach. */
export async function onRepositoryOffer(projectId: string): Promise<RepositoryOffer | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  return (await repositoryOffer(cwd)) ?? null
}

/**
 * The project's git status (#491): active branch, dirty flag, linked PR. Null when not a repo.
 * Pass a live `agentId` to read that agent's worktree, which is the branch and the dirty
 * state that actually belong to it (#738). A run-scoped read is since-filtered (#1255): an agent on
 * a reused pinned branch must not wear a predecessor's merged PR as its own badge.
 */
export async function onGitStatus(projectId: string, agentId?: string): Promise<GitStatus | null> {
  return relayOr(agentId, 'onGitStatus', [projectId, agentId], async () => {
    const cwd = await resolveAgentPath(projectId, agentId)
    if (!cwd) return null
    const since = agentId !== undefined ? startedAtFromAgentId(agentId) : undefined
    return (await readGitStatus(cwd, since !== undefined ? { since } : {})) ?? null
  }, null)
}

/**
 * The end-of-session handoff (#799): the branch a finished session left its work on, what it
 * committed, what it changed, and whether that has been pushed or opened as a PR.
 *
 * Read from the *project* checkout against the session's branch, not from the session's worktree.
 * A clean agent's worktree is removed when it finishes, and `resolveAgentPath` then falls back to the
 * project root — so a worktree-addressed read reports the project's own branch and the user's own
 * uncommitted changes as though they were the session's. The branch is what outlives the agent, so
 * the branch is what this asks about.
 */
export async function onAgentHandoff(projectId: string, agentId: string): Promise<AgentHandoff | null> {
  return relayOr(agentId, 'onAgentHandoff', [projectId, agentId], async () => {
    const cwd = await resolveProjectPath(projectId)
    if (!cwd || !isRunId(agentId)) return null
    const agent = await findAgent(cwd, agentId).catch(() => undefined)
    return (agent && (await readRunHandoff(cwd, agent).catch(() => undefined))) ?? null
  }, null)
}

/**
 * The question a Claude web session is parked on, as reported by the browser bridge (#1237).
 *
 * Keyed by cloud session id rather than agent id because that is what the bridge can see: it reads
 * a claude.ai page, which knows its session and nothing about our runs. The agent view already
 * derives that id from the agent's own `cloud <url>` event, so the join happens on the client
 * without the daemon having to index runs by session.
 *
 * Returns null for anything unrecognised, so an agent with no bridge, no question, or a target that
 * is not `web` renders exactly as it did before.
 */
export async function onBridgeQuestion(sessionId: string): Promise<BridgeQuestion | null> {
  if (!isCloudSessionId(sessionId)) return null
  return bridgeQuestions().get(sessionId) ?? null
}

/**
 * Whether anything has reached the browser bridge, and how it went (#1237).
 *
 * A misconfigured extension and an uninstalled one both leave no question behind, so "nothing is
 * showing" cannot be diagnosed from the questions alone. A refused request at least proves
 * something is trying, and its status says which half is wrong.
 */
export async function onBridgeStatus(): Promise<{
  lastContact: BridgeContact | null
  questions: number
  page: BridgeHello | null
  version: BridgeVersion | null
}> {
  const store = bridgeQuestions()
  return {
    lastContact: store.lastContact() ?? null,
    questions: store.list().length,
    page: store.hello() ?? null,
    version: store.version() ?? null,
  }
}

/**
 * The bridge token, for the setup step where a user pastes it into the extension (#1237).
 *
 * Only while the bridge is on, so a daemon with the feature off never hands the secret to a
 * page. Revealing it here is not a new exposure: anyone who can load this dashboard can already
 * start runs on this machine. What it replaces is the alternative, which was telling people to
 * open `~/.openagent.json` and copy a field out of it.
 */
export async function onBridgeToken(): Promise<string | null> {
  const preferences = await readPreferences()
  if (preferences.bridge !== true) return null
  return (await readBridgeToken()) ?? null
}

/**
 * Where the answer picked for that session's question stands (#1237): queued for the
 * extension, delivered, or failed with the extension's reason. Null when nothing was picked.
 */
export async function onBridgeAnswer(sessionId: string): Promise<BridgeAnswer | null> {
  if (!isCloudSessionId(sessionId)) return null
  return bridgeQuestions().answer(sessionId) ?? null
}

/** What a Claude web session has said so far, as scraped by the browser bridge (#1237). */
export async function onBridgeEvents(sessionId: string): Promise<BridgeEvent[]> {
  if (!isCloudSessionId(sessionId)) return []
  return bridgeQuestions().events(sessionId)
}

/** Where the daemon's own bridge browser stands (#1332): off, starting (and on which step), running, or stopped and why. */
export async function onBridgeBrowser(): Promise<BridgeBrowserStatus> {
  return contextBridgeBrowser().status()
}

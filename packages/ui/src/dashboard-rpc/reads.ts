import { SESSIONS_ID } from '../project-address.js'
import { stat } from 'node:fs/promises'
import { originDefaultBranch } from '@openagt/agent-data'
import { moduleAgents, type ModuleAgent, type ModuleAgentsWanted } from '../dashboard/module-agents.js'
import { join } from 'node:path'
import { doingOf, readRunEvents, readRuns, type AgentDoing, type AgentMeta, isRunId, projectBranches } from '../store/index.js'
import { listProjectWorktrees } from '../worktrees.js'
import { readDocs, type WorkspaceDoc } from '../dashboard/docs.js'
import { buildOverview, buildRecentAgents, type FoundAgent, type Overview, type RecentAgent } from '../dashboard/overview.js'
import { buildWaiting, type Waiting } from '../dashboard/waiting.js'
import type { ProjectionRead, ProjectSummary } from '../dashboard/projects.js'
import { buildActivity, type Activity } from '../dashboard/activity.js'
import { buildDashboard, type DashboardData } from '../dashboard/dashboard.js'
import { readGitStatus } from '../dashboard/git-status.js'
import { readRunHandoff, type AgentHandoff } from '../dashboard/agent-handoff.js'
import { pullRequestState } from '../dashboard/pr-states.js'
import { copyTarget } from '../dashboard/session-copies.js'
import type { AgentWorktree } from '../dashboard/types.js'
import { crawlRepoFiles } from '../project.js'
import { contextHosts, contextProject, contextProjects, contextRun, resolveProjectPath, resolveAgentPath, runHostOf } from './context.js'
import type { RunEvent } from '@openagt/hooks'
import { markOtherHost, withRowMarks } from '../dashboard/run-rows.js'
import type { ProjectRef, RunRef } from '@openagt/hooks'

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
 * The project's runs, most-recent first (or `[]`), as its hosts say them (`run.host`): a working
 * run as it stands now, the moment it starts, and every recorded one, with what the modules read
 * of each marked on it. The sessions with no project are a project of their own here.
 */
export async function onAgents(projectId: string): Promise<AgentMeta[]> {
  const at = await contextProject(projectId)
  const cwd = await resolveProjectPath(projectId)
  return at && cwd ? runRows(at.project, cwd) : []
}

/** A project's runs as its list shows them: its hosts' runs, marked with what the modules read of them off its folder here (`cwd`). */
async function runRows(project: ProjectRef | undefined, cwd: string): Promise<AgentMeta[]> {
  return withRowMarks(cwd, (await readRuns(contextHosts(), project)).map(agent => markOtherHost(agent)))
}

/** A run of the project `projectId`, as its host is asked about it; none for a project that is not on the list. */
async function runRefOf(projectId: string, agentId: string): Promise<RunRef | undefined> {
  const at = await contextProject(projectId)
  return at ? { id: agentId, ...(at.project ? { project: at.project } : {}) } : undefined
}


/**
 * A project's runs as a module sees them ({@link ModuleAgent}), only the ones it asks for: a card
 * shows a few of the hundreds a project keeps, and each run in the few fields a module reads, so
 * what the page reads for it is that much smaller. The same runs as {@link onAgents}.
 */
export async function onModuleAgents(projectId: string, wanted: ModuleAgentsWanted = {}): Promise<ModuleAgent[]> {
  return moduleAgents(await onAgents(projectId), wanted)
}

/**
 * The agent ids that still have a worktree on disk (#737). An agent that failed or was stopped keeps
 * its checkout so you can go look at what it was holding; this is how the dashboard knows which
 * finished run has one to offer removing. Live agents are excluded — their worktree is in use.
 */
export async function onRetainedWorktrees(projectId: string): Promise<string[]> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  const at = await contextProject(projectId)
  const runs = at ? await readRuns(contextHosts(), at.project).catch((): AgentMeta[] => []) : []
  const rows = await listProjectWorktrees(cwd, runs, { sizes: false }).catch((): never[] => [])
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
  const root = await resolveProjectPath(projectId)
  if (!root || !isRunId(agentId)) return null
  const run = await runRefOf(projectId, agentId)
  const found = run ? await (await runHostOf(run)).find(run).catch(() => undefined) : undefined
  const checkout = found?.checkout !== undefined ? { path: found.checkout } : undefined
  // Read only while the checkout's own `.git` is there: without it git reads the project's
  // checkout the run's folder sits in, and answered with the person's branch as the run's.
  const linked = checkout ? await stat(join(checkout.path, '.git')).then(() => true, () => false) : false
  const status = checkout && linked ? await readGitStatus(checkout.path).catch(() => undefined) : undefined
  // The run's pull request is the one its record names, as its git host module last read it.
  const agent = await contextRun(projectId, agentId).catch(() => undefined)
  const state = agent?.pr ? pullRequestState(agent.pr.url)?.state : undefined
  const pr = agent?.pr ? { ...agent.pr, ...(state ? { state } : {}) } : undefined
  if (!checkout || !status) {
    // The checkout's branch was the agent's; with no checkout the record is the only witness. So
    // it is for a checkout git cannot read: the run's clean-up is removing it, and an answer
    // without its branch put the bar above the message box away until the next read.
    if (!agent) return null
    return { ...(agent.branch ? { branch: agent.branch } : {}), ...(pr ? { pr } : {}) }
  }
  // Size is only read for a checkout nothing is writing to: a live agent's tree changes under the
  // poll, and a size over a build directory mid-build is a cost with no answer worth having. The
  // provider's sized listing is where a checkout's size comes from (#1774).
  const running = found?.record?.status === 'running'
  const size = running ? undefined : (await (await projectBranches(root).catch(() => undefined))?.list({ sizes: true }).catch(() => []))?.find(row => row.id === agentId)?.sizeBytes
  return {
    checkout: { path: checkout.path, dirty: status.dirty, ...(size !== undefined ? { sizeBytes: size } : {}) },
    branch: status.branch,
    // A session's branch is exactly the thing that has a PR (#809), so the bar can show it
    // like the project's does.
    ...(pr ? { pr } : {}),
  }
}

/** One run's events for replay, as its host says them (or `[]` when the run or project is gone). */
export async function onAgent(projectId: string, agentId: string): Promise<RunEvent[]> {
  const run = isRunId(agentId) ? await runRefOf(projectId, agentId) : undefined
  if (!run) return []
  return (await readRunEvents(await runHostOf(run), run).catch(() => undefined)) ?? []
}

/** What each of the named runs of a project is doing now, by id, as its events say; a run that is not working has no entry. */
export async function onAgentsDoing(projectId: string, agentIds: string[]): Promise<Record<string, AgentDoing>> {
  const at = await contextProject(projectId)
  if (!at) return {}
  const working = (await readRuns(contextHosts(), at.project, { ids: agentIds }).catch((): AgentMeta[] => [])).filter(agent => agent.status === 'running')
  const doing = await Promise.all(
    working.map(async agent => {
      const run: RunRef = { id: agent.id, ...(at.project ? { project: at.project } : {}) }
      const events = await readRunEvents(await runHostOf(run), run).catch(() => undefined)
      return [agent.id, events && doingOf(events)] as const
    }),
  )
  return Object.fromEntries(doing.filter((entry): entry is readonly [string, AgentDoing] => entry[1] !== undefined))
}

/** The surfaced PLAN/TODO docs at the workspace root, in sidebar order (or `[]`). */
export async function onDocs(projectId: string): Promise<WorkspaceDoc[]> {
  const cwd = await resolveProjectPath(projectId)
  return cwd ? readDocs(cwd).catch(() => []) : []
}

/** The cross-project Overview (#437): what is running now, and recent projects. */
export async function onOverview(): Promise<Overview> {
  return withProjects(projects => buildOverview(projects))
}

/** Recent sessions pooled across every project and the sessions with no project (#shared-shell), newest first, for the home rail. */
export async function onRecentAgents(): Promise<RecentAgent[]> {
  return pooledRuns()
}

/** Every run of every project and the sessions with no project, newest first, each in the few fields the jump finds it by and marks it with. */
export async function onAllAgents(): Promise<FoundAgent[]> {
  return (await pooledRuns(Infinity)).map(({ projectId, projectName, agent: { id, status, title, intent, branch, pr, prTitle, startedAt } }) => ({
    projectId,
    projectName,
    agent: { id, status, startedAt, ...(title !== undefined ? { title } : {}), ...(intent !== undefined ? { intent } : {}), ...(branch !== undefined ? { branch } : {}), ...(pr !== undefined ? { pr } : {}), ...(prTitle !== undefined ? { prTitle } : {}) },
  }))
}

/** The runs of every project, as each project's own list shows them: the newest `limit`. */
async function pooledRuns(limit?: number): Promise<RecentAgent[]> {
  return withProjects(projects =>
    buildRecentAgents(
      projects,
      {
        agents: project => runRows({ id: project.id, name: project.name, dir: project.path }, project.path),
        sessions: async () => {
          const home = await resolveProjectPath(SESSIONS_ID)
          return home ? runRows(undefined, home) : []
        },
      },
      limit,
    ),
  )
}


/**
 * What waits on the person, across the projects (#632, #2394): every module's `waiting` items of
 * `app.attention`, and the ones the shell still finds itself, newest first, plus which projects
 * were read whole (#1625).
 *
 * The panels render `items` and ignore the rest. The browser's notifier is the caller that cannot:
 * it keeps a baseline of what was already waiting when the page opened, and a queue that came back
 * empty because the git host was unreachable is not a baseline — taking it for one announces the whole
 * backlog the moment the git host answers.
 */
export async function onWaiting(): Promise<ProjectionRead<Waiting>> {
  return withProjects(async projects => buildWaiting(projects, {}, await resolveProjectPath(SESSIONS_ID).catch(() => undefined)))
}

/**
 * The cross-project "New activity" feed (#627): recent run started/finished transitions, newest
 * first, with the projects that were read whole beside them (#1625) — see {@link onWaiting}.
 */
export async function onActivity(): Promise<ProjectionRead<Activity>> {
  return withProjects(projects => buildActivity(projects, { readAgents: project => readRuns(contextHosts(), { id: project.id, name: project.name, dir: project.path }) }))
}

/** The Overview dashboard page (#471): the {@link onOverview} rollup, and how many projects there are. */
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
 * The Overview's summary as last built, and the build under way: it reads every project's runs at
 * work, so a page is answered at once with the last summary for the same projects while it is
 * built again behind it.
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
  // The checkout `agentId` names: its own while the run is live, else the project's root (#738).
  const cwd = await resolveAgentPath(projectId, agentId)
  return cwd ? crawlRepoFiles(cwd).catch(() => []) : []
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
export async function onAgentHandoff(projectId: string, agentId: string, repo?: string): Promise<AgentHandoff | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !isRunId(agentId)) return null
  const agent = await contextRun(projectId, agentId).catch(() => undefined)
  if (!agent) return null
  // One of the session's copies of repos: the same read, of the copy's own folder and branch.
  if (repo !== undefined) {
    const copy = await copyTarget(agent, repo)
    return (copy && (await readRunHandoff(copy.cwd, copy.agent).catch(() => undefined))) ?? null
  }
  return (await readRunHandoff(cwd, agent).catch(() => undefined)) ?? null
}

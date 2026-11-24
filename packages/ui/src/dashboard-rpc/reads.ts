import { SESSIONS_ID } from '../project-address.js'
import { stat } from 'node:fs/promises'
import { originDefaultBranch } from '@openagt/agent-data'
import { moduleAgents, type ModuleAgent, type ModuleAgentsWanted } from '../dashboard/module-agents.js'
import { join } from 'node:path'
import { findAgent, findCheckout, readLiveMetas, readDoing, loadAgentEvents, type AgentDoing, startedAtFromAgentId, type AgentMeta, isRunId, projectBranches } from '../store/index.js'
import { listProjectWorktrees } from '../worktrees.js'
import { projectGitHost, type GitHostHome } from '../store/git-host.js'
import { repositoryOffer, type RepositoryOffer } from '../store/repository.js'
import { readDocs, type WorkspaceDoc } from '../dashboard/docs.js'
import { buildOverview, buildRecentAgents, type FoundAgent, type Overview, type RecentAgent } from '../dashboard/overview.js'
import { buildWaiting, type Waiting } from '../dashboard/waiting.js'
import type { ProjectionRead, ProjectSummary } from '../dashboard/projects.js'
import { buildActivity, type Activity } from '../dashboard/activity.js'
import { buildDashboard, type DashboardData } from '../dashboard/dashboard.js'
import { readGitStatus } from '../dashboard/git-status.js'
import { readRunHandoff, resolveAgentPr, type AgentHandoff } from '../dashboard/agent-handoff.js'
import { copyTarget } from '../dashboard/session-copies.js'
import type { AgentWorktree } from '../dashboard/types.js'
import { crawlRepoFiles } from '../project.js'
import { contextProjects, resolveProjectPath, resolveAgentPath } from './context.js'
import type { OpenAgentEvent } from '../events.js'
import { startedName, withStartedNames } from '@openagt/agent-driver'
import { forDashboard, recordedRuns, withRowMarks } from '../dashboard/run-rows.js'

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
 */
export async function onAgents(projectId: string): Promise<AgentMeta[]> {
  return runRows(await resolveProjectPath(projectId))
}

/**
 * The name asked for a run just started, answered once it is in (agent-driver's `started-names.ts`): the run's
 * row is not in the list yet when it is, and the page shows it where the row will be. Nothing
 * when no name came.
 */
export async function onStartedName(agentId: string): Promise<string | undefined> {
  return startedName(agentId)
}

/** A project's runs as its list shows them, off its folder here (`cwd`): none for a project with no folder here. */
async function runRows(cwd: string | undefined): Promise<AgentMeta[]> {
  return cwd ? withStartedNames(await withRowMarks(cwd, (await recordedRuns(cwd)).map(forDashboard))) : []
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
}

/** One archived agent's event log for replay (or `[]` when the agent or project is gone). */
export async function onAgent(projectId: string, agentId: string): Promise<OpenAgentEvent[]> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  return (await loadAgentEvents(cwd, agentId).catch(() => undefined)) ?? []
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
        agents: project => runRows(project.path),
        sessions: async () => runRows(await resolveProjectPath(SESSIONS_ID)),
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
  return withProjects(projects => buildActivity(projects, { readAgents: project => recordedRuns(project.path) }))
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
  const agent = await findAgent(cwd, agentId).catch(() => undefined)
  if (!agent) return null
  // One of the session's copies of repos: the same read, of the copy's own folder and branch.
  if (repo !== undefined) {
    const copy = await copyTarget(agent, repo)
    return (copy && (await readRunHandoff(copy.cwd, copy.agent).catch(() => undefined))) ?? null
  }
  return (await readRunHandoff(cwd, agent).catch(() => undefined)) ?? null
}

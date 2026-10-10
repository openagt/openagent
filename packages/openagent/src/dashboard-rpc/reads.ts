import type { BridgeBrowserStatus } from '../bridge-browser.js'
import { findAgent, findCheckout, readLiveMetas, readAllAgents, readDoing, loadAgentEvents, startedAtFromAgentId, isPidAlive, type AgentMeta, type AgentStatus, isRunId, projectBranches } from '../store/index.js'
import { listProjectWorktrees } from '../worktrees.js'
import { projectGitHost, type GitHostHome } from '../store/git-host.js'
import { repositoryOffer, type RepositoryOffer } from '../store/repository.js'
import { readDocs, type WorkspaceDoc } from '../dashboard/docs.js'
import { collectQueue, type ProjectQueue } from '../dashboard/queue.js'
import { buildOverview, buildRecentAgents, type Overview, type RecentAgent } from '../dashboard/overview.js'
import { buildInterventions, type Intervention } from '../dashboard/interventions.js'
import type { ProjectionRead } from '../dashboard/projects.js'
import { buildOpenQuestions, type OpenQuestion } from '../dashboard/open-questions.js'
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
import type { BridgeEvent, BridgeHello, BridgeQuestion } from '../dashboard/bridge-endpoints.js'
import type { BridgeAnswer, BridgeContact, BridgeVersion } from '../dashboard/bridge-store.js'
import { readDaemonToken, readPreferences, type Preferences } from '../registry.js'
import { hostname } from 'node:os'

// The read model behind the dashboard (#405): the agent history, an agent's replay, and the
// surfaced PLAN/TODO docs — each keyed by project id and backed by
// the readers that own those files, so the dashboard stays a projection of the same files. They live beside the daemon rather than in the
// browser's own tree so it can serve them in-process; the dashboard calls them by name over
// `POST /_rpc/<name>`. The live agent stream is its own endpoint (`GET /_rpc/events`).

/**
 * Resolve a project id and run a forgiving read against its workspace: an unknown project
 * or a failing read both fall back to `empty`. The uniform readers below are one call each
 * over this; the agent history and null-returning git readers stay bespoke (extra logic or a
 * distinct empty).
 */
async function withProject<T>(projectId: string, read: (cwd: string) => Promise<T>, empty: T): Promise<T> {
  const cwd = await resolveProjectPath(projectId)
  return cwd ? read(cwd).catch(() => empty) : empty
}

/**
 * The `withProject` twin for a run-scoped read: resolve the checkout a `agentId` names (its own
 * worktree while live, else the project root, #738), then read forgivingly. An absent project
 * or a failing read both fall back to `empty`.
 */
async function withAgentPath<T>(projectId: string, agentId: string | undefined, read: (cwd: string) => Promise<T>, empty: T): Promise<T> {
  const cwd = await resolveAgentPath(projectId, agentId)
  return cwd ? read(cwd).catch(() => empty) : empty
}

/** Run a cross-project rollup over every registered project, tolerating a failed registry read. */
async function withProjects<T>(build: (projects: Awaited<ReturnType<ReturnType<typeof contextProjects>['list']>>) => Promise<T>): Promise<T> {
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
  // The relayed-agent stubs (#1077). Read up front by habit rather than by necessity now: the
  // context was request-scoped and evaporated at the first await, so reading it late dropped
  // every remote agent from the list on a reload. It is wired once at start-up (F3), so an await
  // no longer costs anything — nothing here depends on this staying above one.
  const remote = contextRemote()?.list(projectId) ?? []
  const cwd = await resolveProjectPath(projectId)
  const local = cwd ? (await readAllAgents(cwd)).map(forDashboard) : []
  if (remote.length === 0) return local
  // A relayed agent (#1067) lives only in the daemon's memory, not on disk; surface it in the list so
  // a reload re-opens it instead of losing it. Remote wins an id tie (it is the live authority).
  return [...remote, ...local.filter(agent => !remote.some(r => r.id === agent.id))]
}

/**
 * A web run whose cloud session is waiting on a human — the bridge holds its parked question, or
 * claude.ai's session list shows it awaiting input (#1332) — is marked waiting (#1668), so its row
 * says so instead of "in cloud": the archive on disk cannot know, only the daemon's bridge store
 * does. Every other run passes through untouched.
 */
export function markCloudWaiting(agent: AgentMeta): AgentMeta {
  if (agent.target !== 'web' || !agent.sessionId || !bridgeQuestions().waiting(agent.sessionId)) return agent
  return { ...agent, cloudWaiting: true }
}

/**
 * A run another machine's daemon started is marked as from another host (#1648): the data branch
 * is shared precisely so other machines' runs show up here, and a row that looked exactly like
 * one of this daemon's own sent the user reading the archive by hand to learn whose it was. A run
 * with no recorded host predates the field and passes through untouched.
 */
export function markOtherHost(agent: AgentMeta, thisHost: string = hostname()): AgentMeta {
  if (agent.host === undefined || agent.host === thisHost) return agent
  return { ...agent, otherHost: true }
}

/**
 * A run that ended clean while the process its card names is still alive on this host is marked
 * saving: the tool that runs it saves the run's record and cleans up its checkout after the card says
 * done, and a row that said "done" through that window read as finished with nothing coming. A
 * run of another host, or with no recorded process, passes through untouched.
 */
export function markSaving(agent: AgentMeta, thisHost: string = hostname(), alive: (pid: number) => boolean = isPidAlive): AgentMeta {
  if (agent.status !== 'done' || agent.pid === undefined || agent.host !== thisHost || !alive(agent.pid)) return agent
  return { ...agent, saving: true }
}

/** Every annotation a run's record gets on its way to the dashboard: what the daemon knows and the disk cannot. */
function forDashboard(agent: AgentMeta): AgentMeta {
  return markSaving(markOtherHost(markCloudWaiting(agent)))
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
    if (!checkout) {
      // The checkout's branch was the agent's; with no checkout the record is the only witness.
      const agent = await findAgent(root, agentId).catch(() => undefined)
      if (!agent) return null
      const pr = await resolveAgentPr(root, agent).catch(() => ({ value: undefined, pending: false }))
      return {
        ...(agent.branch ? { branch: agent.branch } : {}),
        ...(pr.value ? { pr: pr.value } : {}),
        ...(pr.pending ? { prPending: true } : {}),
      }
    }
    // Since-filtered like every run-scoped PR read (#1255): the checkout's branch is the agent's,
    // but a reused pinned branch has a predecessor's PR history.
    const since = startedAtFromAgentId(agentId)
    const [status, live] = await Promise.all([
      readGitStatus(checkout.path, { prRoot: root, ...(since !== undefined ? { since } : {}) }).catch(() => undefined),
      readLiveMetas(root).catch(() => []),
    ])
    // Size is only read for a checkout nothing is writing to: a live agent's tree changes under the
    // poll, and a size over a build directory mid-build is a cost with no answer worth having. The
    // provider's sized listing is where a checkout's size comes from (#1774).
    const running = live.some(agent => agent.id === agentId && agent.status === 'running')
    const size = running ? undefined : (await (await projectBranches(root).catch(() => undefined))?.list({ sizes: true }).catch(() => []))?.find(row => row.id === agentId)?.sizeBytes
    return {
      checkout: { path: checkout.path, dirty: status?.dirty ?? false, ...(size !== undefined ? { sizeBytes: size } : {}) },
      ...(status?.branch ? { branch: status.branch } : {}),
      // A session's branch is exactly the thing that has a PR (#809), so the bar can show it
      // like the project's does.
      ...(status?.pr ? { pr: status.pr } : {}),
      // Still being looked up rather than absent (#1028), so the bar can ask again shortly.
      ...(status?.prPending ? { prPending: true } : {}),
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
export async function onAgentsDoing(projectId: string, agentIds: string[]): Promise<Record<string, string>> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return {}
  return readDoing(cwd, agentIds).catch(() => ({}))
}

/** The surfaced PLAN/TODO docs at the workspace root, in sidebar order (or `[]`). */
export async function onDocs(projectId: string): Promise<WorkspaceDoc[]> {
  return withProject(projectId, readDocs, [])
}

/** The aggregated open TODO queue across every registered project (#438), most-open first. */
export async function onQueue(): Promise<ProjectQueue[]> {
  return withProjects(collectQueue)
}

/** The cross-project Overview (#437): what is running now, the queue size, and recent projects. */
export async function onOverview(): Promise<Overview> {
  return withProjects(buildOverview)
}

/** Recent sessions pooled across every project (#shared-shell), newest first, for the home rail. */
export async function onRecentAgents(): Promise<RecentAgent[]> {
  const recent = await withProjects(projects => buildRecentAgents(projects))
  return recent.map(row => ({ ...row, agent: forDashboard(row.agent) }))
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
  return withProjects(buildInterventions)
}

/** Every session's open question with its full gate (#1455), longest-waiting first: the launcher's hub. */
export async function onOpenQuestions(): Promise<OpenQuestion[]> {
  return withProjects(buildOpenQuestions)
}

/**
 * The cross-project "New activity" feed (#627): recent run started/finished transitions, newest
 * first, with the projects that were read whole beside them (#1625) — see {@link onInterventions}.
 */
export async function onActivity(): Promise<ProjectionRead<Activity>> {
  return withProjects(buildActivity)
}

/** The Overview dashboard page (#471): the {@link onOverview} rollup plus agent counts, run-status totals, and activity. */
export async function onDashboard(): Promise<DashboardData> {
  return withProjects(buildDashboard)
}

/**
 * The project's files for the `#` context picker (#504) and the Context's file count (#661): every
 * file git sees (tracked + untracked, honoring .gitignore), repo-relative and sorted, via
 * `git ls-files`. Localhost-only by nature — the relay has no checkout, so it resolves `[]`.
 * Pass a live `agentId` to list that agent's worktree instead of the project root (#738). The
 * Files tab reads its own list, through its module.
 */
export async function onProjectFiles(projectId: string, agentId?: string): Promise<string[]> {
  return relayOr(agentId, 'onProjectFiles', [projectId, agentId], () => withAgentPath(projectId, agentId, crawlRepoFiles, []), [])
}

/** The project's page on its git host and the git host's name (#489, #1820), or null: no git host package, no remote there, or the relay. */
export async function onGitHostHome(projectId: string): Promise<GitHostHome | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const gitHost = await projectGitHost(cwd).catch(() => undefined)
  return (await gitHost?.home()) ?? null
}

/** The repository the project's provider offers to create for it (a project with no remote), or null: no provider, a remote already there, the host out of reach, or the relay. */
export async function onRepositoryOffer(projectId: string): Promise<RepositoryOffer | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  return (await repositoryOffer(cwd)) ?? null
}

/**
 * The project's git status (#491): active branch, dirty flag, linked PR. Null when not a repo /
 * relay. Pass a live `agentId` to read that agent's worktree, which is the branch and the dirty
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
  if (typeof sessionId !== 'string' || !/^session_[A-Za-z0-9]{1,128}$/.test(sessionId)) return null
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
 * start runs on this machine, and on a non-loopback bind their browser is holding the same token
 * as a cookie. What it replaces is the alternative, which was telling people to open
 * `~/.openagent.json` and copy a field out of it.
 */
export async function onBridgeToken(): Promise<string | null> {
  const preferences = await readPreferences().catch((): Preferences => ({}))
  if (preferences.bridge !== true) return null
  return (await readDaemonToken().catch(() => undefined)) ?? null
}

/**
 * Where the answer picked for that session's question stands (#1237): queued for the
 * extension, delivered, or failed with the extension's reason. Null when nothing was picked.
 */
export async function onBridgeAnswer(sessionId: string): Promise<BridgeAnswer | null> {
  if (typeof sessionId !== 'string' || !/^session_[A-Za-z0-9]{1,128}$/.test(sessionId)) return null
  return bridgeQuestions().answer(sessionId) ?? null
}

/** What a Claude web session has said so far, as scraped by the browser bridge (#1237). */
export async function onBridgeEvents(sessionId: string): Promise<BridgeEvent[]> {
  if (typeof sessionId !== 'string' || !/^session_[A-Za-z0-9]{1,128}$/.test(sessionId)) return []
  return bridgeQuestions().events(sessionId)
}

/** Where the daemon's own bridge browser stands (#1332): off, starting (and on which step), running, or stopped and why. */
export async function onBridgeBrowser(): Promise<BridgeBrowserStatus> {
  return contextBridgeBrowser().status()
}

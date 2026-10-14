import { hostname } from 'node:os'
import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { cachedPrView, cachedPrsForBranch, forgetBranchPrs, forgetPr, pickAgentPr, type LinkedPr, type BranchPrLookup } from './pull-requests.js'
import type { Cached } from './cache.js'
import type { AgentMeta } from '../store/index.js'
import { projectBranches, type BranchesFor } from '../store/branches.js'
import { projectGitHost, type GitHostFor } from '../store/git-host.js'
import { projectRuns, type RunsFor } from '../store/runs.js'
// What a finished session produced, and what is left to do with it (#799).
//
// Everything up to "the agent is done" was covered; the handoff back to the human was not. A
// clean run archives its history, commits what it was holding, removes its worktree and leaves
// the work on a branch. Nothing pushed, nothing opened, and the dashboard showed none of it.
//
// The read is deliberately *branch*-addressed, not worktree-addressed: the common end state has
// no worktree left, so a checkout-based read (`onAgentWorktree`) falls back to the project root and
// reports the project's own branch as if it were the session's. Here the branch is the subject and
// the project repo is only where it is read from, so a finished session reads the same whether or
// not its checkout still exists.
//
// The branch's git facts and its push are the project's branches provider's (#1774), and every
// pull request, opened or landed, is the project's git host provider's (#1820): OpenAgent asks the
// packages the project picked, through the commands they declare (`store/branches.ts`,
// `store/git-host.ts`), and never runs git or a git host tool itself. Opening a pull request is the two
// composed: the push, then the open. What stays here is what is about the *run*: which of the
// branch's pull requests is this run's, when an existing pull request is the answer and when a new
// one is, and what the pull request says.
//
// Forgiving throughout: a project with no branches provider, no git host, or no remote yields a
// handoff with less in it, never an error. Without a git host the run's last step is the push.

/** One commit a session put on its branch. */
export interface HandoffCommit {
  sha: string
  /** Short sha, for display. */
  short: string
  subject: string
}

/** One file the session changed, against the branch point. */
export interface HandoffFile {
  path: string
  insertions: number
  deletions: number
  /** True for a binary file, where line counts are meaningless. */
  binary: boolean
}

/** What a finished session produced and what can still be done with it. */
export interface AgentHandoff {
  /** The branch the work is on. */
  branch: string
  /** The name the agent gave its work, as the branches provider answers it; absent while the run has not named it. */
  name?: string
  /** The branch still exists in the repo (a deleted or never-created one does not). */
  exists: boolean
  /** The branch is gone because the run changed nothing ({@link leftNothing}), not because work went. */
  unchanged?: boolean
  /**
   * The run's work was landed: merged into its main agent's branch by that agent, or into the
   * project's default branch by the person, on this machine. The run's own branch went with that,
   * and what is read here is what it held, by the last commit its record kept.
   */
  landed?: boolean
  /** What the branch is measured against: the repo's default branch, or the commit the run's own work begins at (a run started from another branch, or one already merged), when one was found. */
  base?: string
  commits: HandoffCommit[]
  files: HandoffFile[]
  insertions: number
  deletions: number
  /**
   * The session produced nothing to hand off: the branch exists but carries no commit the base
   * does not already have — or nothing beyond OpenAgent's own bookkeeping (#1291), which is
   * committed for provenance, never as publishable work. Said out loud, rather than shown as an
   * empty branch.
   */
  empty: boolean
  /** The repo has a remote to push to at all. */
  hasRemote: boolean
  /** The branch is on the remote and the remote is at the same commit. */
  pushed: boolean
  /** The branch is already merged into the base. */
  merged: boolean
  /** The project has a git host package (#1820): a pull request is a next step at all. Without one, the last step is the push. */
  gitHost: boolean
  /** The PR opened for this branch, when there is one. */
  pr?: LinkedPr
  /** The PR is not known yet, rather than absent (#1028): the lookup is still running. */
  prPending?: boolean
  /**
   * The session kept committing after its PR merged or closed (#1512): the branch holds commits
   * on top of the PR's head, so the PR is not the answer to that work, which needs a pull request
   * of its own.
   */
  movedPastPr?: boolean
  /**
   * What a pull request for this branch would carry beyond the run's own work: the branch measured
   * against the project's default branch, for a run started from another branch.
   *
   * A run started from a branch of this machine sits on that branch's unlanded commits, and its own
   * work is measured from where it began ({@link base}) — which is the right count of what the run
   * did. The pull request, though, goes to the default branch, so that branch's work rides along in
   * it. Absent when a pull request would carry exactly what the run did, which is every run started
   * from the branch the project starts agents from.
   */
  carries?: {
    /** The branch a pull request would go to, as the branches provider names it. */
    base: string
    commits: number
    files: number
    insertions: number
    deletions: number
  }
  /**
   * The files the session changed and never committed, read from its own checkout (#1173).
   *
   * The agent is told to commit its work, but one that ended without doing so holds its whole
   * output in an uncommitted tree, and nothing commits it on the agent's behalf (#1638). That work
   * is not on the branch yet, so it is
   * not in {@link commits} and it does not make {@link empty} false. Paths rather than a count,
   * because a no-diff branch must *name* what is waiting instead of offering an Open PR that
   * the git host can only refuse. Absent when no checkout is on the branch any more — "no checkout"
   * and "a checkout, tree clean" are different answers.
   */
  pendingFiles?: string[]
}

/** Injectable seams so the reader is unit-testable off disk and off the provider. */
export interface AgentHandoffDeps {
  pr?: BranchPrLookup
  /** The project's checkouts and branches (default the project's provider, {@link projectBranches}). */
  branches?: BranchesFor
  /** The project's git host (default the project's provider, {@link projectGitHost}). */
  gitHost?: GitHostFor
  /**
   * When the agent started (ISO), so the PR lookup can tell the agent's own PR from an earlier agent's
   * on the same branch name (#1251). Without it, only an open PR is trusted.
   */
  since?: string
  /**
   * Which of the run's own PRs answers, when it has more than one (#1512). Identity questions want
   * the first; a handoff decision comparing the branch tip against a PR's head wants the last one
   * that saw the branch, or work a later PR already landed reads as unlanded. See {@link pickAgentPr}.
   */
  order?: 'first' | 'latest'
  /** The commit the run's own work begins at ({@link AgentMeta.baseCommit}): what the branch is measured from. */
  from?: string
  /** How git is asked whether the branch holds commits on top of its PR's head (default the real one). */
  git?: GitRunner
}

/**
 * The branch an agent's work is on: what was recorded while the checkout existed (#799/#1277).
 * The agent renames its branch itself (#1725), so anything but the record is a guess, and a run
 * whose record carries no branch has none to hand off.
 */
export function agentBranchFor(agent: { id: string; branch?: string }): string | undefined {
  return agent.branch
}

/**
 * Whether a run whose branch is gone changed nothing (#1850): it ended `done`, `failed` or
 * `stopped` on this machine, has no pull request, and was not landed by a main agent (a landed
 * run's branch went because its work moved on, not for holding nothing). Such a run's own tool recorded the branch's
 * last name as it ended, a Stop included, and then reclaimed the checkout, and the branches rule
 * deletes a branch with the checkout only when it holds nothing. A run whose process died is marked
 * `stopped` by the sweep only when it left no checkout, so it had nowhere to keep a change. A run
 * another machine ran leaves no such proof here, and one `waiting` keeps its checkout.
 */
export function leftNothing(agent: { status?: string; host?: string; pr?: unknown; landed?: string }, host: string = hostname()): boolean {
  return !agent.pr && agent.landed === undefined && (agent.status === 'done' || agent.status === 'failed' || agent.status === 'stopped') && agent.host === host
}

/**
 * The branch's PR as it applies to *this* run: the injected seam when the caller gave one, else
 * the cached history filtered through {@link pickAgentPr} with the agent's start time (#1251).
 */
async function lookupAgentPr(cwd: string, branch: string, deps: AgentHandoffDeps): Promise<Cached<LinkedPr | undefined> & { latest?: LinkedPr | undefined }> {
  if (deps.pr) {
    const value = await deps.pr(cwd, branch).catch(() => undefined)
    return { value, latest: value, pending: false }
  }
  const prs = await cachedPrsForBranch(cwd, branch).catch(() => ({ value: undefined, pending: false }))
  // `latest` beside the run's own PR: whether the session moved past its PR is asked of the PR
  // that last saw the branch ({@link pickAgentPr}).
  return {
    value: prs.value ? pickAgentPr(prs.value, deps.since, deps.order) : undefined,
    latest: prs.value ? pickAgentPr(prs.value, deps.since, 'latest') : undefined,
    pending: prs.pending,
  }
}

/** The cached single-PR read {@link resolveAgentPr} asks for the recorded PR's current state. */
export type CachedBranchPrLookup = (cwd: string, branch?: string) => Promise<Cached<LinkedPr | undefined>>

/** What {@link resolveAgentPr} needs to know about an agent: structurally satisfied by {@link AgentMeta}. */
export interface PrAgent {
  id: string
  branch?: string
  /** The pull request the agent recorded when one was opened for it (E6). */
  pr?: { number: number; url: string }
}

/**
 * The pull request that belongs to an agent: the one it recorded (E6), read live for its state.
 *
 * The number is a fact about the agent, so the agent writes it down — at the moment its handoff opens
 * the PR, or when the dashboard's button does after the process is gone. Every surface then reads
 * the same integer instead of re-deriving it.
 *
 * What that replaced: a three-way branch-name ladder (the recorded branch, then a branch built from
 * the session name, then the run-id branch, because a hands-off web agent's checkout is gone and its
 * session name may be a reused pin) plus a timestamp heuristic on top of it, so that a predecessor's PR on
 * a shared branch name was not mistaken for this agent's. Three sources and a guess, standing in for
 * one integer nobody had written down — the same lesson the `branch` event (#1277) already learned.
 *
 * The *state* is still read live, because it changes without this agent doing anything: a PR merges,
 * a human closes it. That read rides the PR-lookup cache (#1028), and `pending` while it is warming means the
 * caller can ask again rather than render "no PR".
 */
export async function resolveAgentPr(
  cwd: string,
  agent: PrAgent,
  prs: CachedBranchPrLookup = cachedPrView,
): Promise<Cached<LinkedPr | undefined>> {
  if (!agent.pr) return { value: undefined, pending: false }
  const branch = agentBranchFor(agent)
  const read = await prs(cwd, branch).catch((): Cached<LinkedPr | undefined> => ({ value: undefined, pending: false }))
  // The live read is about the recorded PR's *state*; a different number on the branch is some
  // other PR and never this agent's answer.
  if (read.value && read.value.number === agent.pr.number) return { value: read.value, pending: false }
  // Nothing live to say, so the recorded fact stands on its own: an agent whose PR is on a branch this
  // machine cannot see still has a PR, and its number and URL are what the surfaces need.
  return { value: { ...agent.pr, state: read.pending ? 'OPEN' : 'UNKNOWN', title: '' }, pending: read.pending }
}

/**
 * Merge a finished session's open PR (#1391): the Merge action, pressed by a human saying "it's
 * good, land it". The landing itself is the git host provider's (`merge <number>`): armed to merge on
 * green, merged at once where it is already green, or watched by the provider where the
 * repository allows no auto-merge; a draft is marked ready on the way. Refuses when the agent has
 * no PR or it is no longer open — "already merged" is an answer, not an action.
 */
export async function mergeAgentPr(
  cwd: string,
  agent: PrAgent,
  deps: { gitHost?: GitHostFor; prs?: CachedBranchPrLookup } = {},
): Promise<HandoffResult> {
  const pr = (await resolveAgentPr(cwd, agent, deps.prs)).value
  if (!pr) return { ok: false, error: 'this session has no pull request to merge' }
  if (pr.state !== 'OPEN') return { ok: false, error: `this session's PR is already ${pr.state.toLowerCase()}` }
  const gitHost = await (deps.gitHost ?? projectGitHost)(cwd).catch(() => undefined)
  if (!gitHost) return { ok: false, error: 'this project has no git host package to merge with' }
  const merged = await gitHost.merge(pr.number)
  if (!merged.ok) return { ok: false, error: merged.error }
  // The PR's cached state just changed, so the branch's cached read must go or the bar keeps
  // offering a merge for a PR that landed (#1028).
  const branch = agentBranchFor(agent)
  forgetPr(cwd, branch)
  if (branch !== undefined) forgetBranchPrs(cwd, branch)
  return { ok: true, url: pr.url, number: pr.number }
}

/**
 * Read what a finished session left behind, for `branch`: the branch's git facts from the
 * project's branches provider, and the run's own pull request from OpenAgent's lookup.
 *
 * Returns undefined only when the project has no branches provider, or the provider did not
 * answer for the branch. A branch that no longer exists still returns a handoff (with
 * `exists: false`), because "that branch is gone" is itself the answer the dashboard needs to
 * show — and its PR is a remote question, still answerable (#1255).
 */
export async function readAgentHandoff(
  cwd: string,
  branch: string,
  deps: AgentHandoffDeps = {},
): Promise<AgentHandoff | undefined> {
  const branches = await (deps.branches ?? projectBranches)(cwd).catch(() => undefined)
  if (!branches) return undefined
  const [state] = await branches.show([branch], deps.from)
  if (!state) return undefined
  const gitHost = await (deps.gitHost ?? projectGitHost)(cwd).catch(() => undefined)
  // Read through the cache and allowed to arrive late (#1028): the branch's facts are local
  // git, and none of them should wait on the git host.
  const pr = await lookupAgentPr(cwd, branch, deps)
  const commits = state.commits.map(commit => ({ sha: commit.sha, short: commit.sha.slice(0, 7), subject: commit.subject }))
  const files = state.files.map(file => ({ path: file.path, insertions: file.insertions, deletions: file.deletions, binary: file.binary }))
  return {
    branch,
    ...(state.name ? { name: state.name } : {}),
    exists: state.exists,
    ...(state.base ? { base: state.base } : {}),
    commits,
    files,
    insertions: files.reduce((sum, f) => sum + f.insertions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    // A session that changed nothing is a real outcome, not an error: it gets said, not shown as
    // an empty branch with buttons that would push nothing. The files decide as well as the
    // commits: commits that net to no change leave nothing to hand off.
    empty: commits.length === 0 || files.length === 0,
    hasRemote: state.hasRemote,
    pushed: state.pushed,
    merged: state.merged,
    gitHost: gitHost !== undefined,
    ...(pr.value ? { pr: pr.value } : {}),
    ...(pr.pending ? { prPending: true } : {}),
    ...((await commitsPastPr(cwd, pr.latest, commits, deps.git)) ? { movedPastPr: true } : {}),
    ...(state.pendingFiles ? { pendingFiles: state.pendingFiles } : {}),
  }
}

/**
 * What a finished run left behind, off its record: {@link readAgentHandoff} for the branch the
 * record names, measured from the commit the run's own work begins at when the record names one
 * (a run started from another branch holds, beyond the default branch, that branch's work too).
 *
 * A run its main agent landed has no branch left: what it held is read by the last commit its
 * record kept, and the answer says landed. A branch gone because the run changed nothing is said
 * as that, not as lost work. Undefined for a run with neither a branch nor a landed commit.
 */
export async function readRunHandoff(
  cwd: string,
  agent: Pick<AgentMeta, 'id' | 'startedAt' | 'branch' | 'baseCommit' | 'landed' | 'status' | 'host' | 'pr'>,
  deps: AgentHandoffDeps = {},
): Promise<AgentHandoff | undefined> {
  const at = agentBranchFor(agent) ?? agent.landed
  if (at === undefined) return undefined
  // A commit has no pull request to look up: only a branch is asked of the git host.
  const noPr: AgentHandoffDeps = agentBranchFor(agent) === undefined ? { pr: async () => undefined } : {}
  const handoff = await readAgentHandoff(cwd, at, { since: agent.startedAt, ...(agent.baseCommit !== undefined ? { from: agent.baseCommit } : {}), ...deps, ...noPr })
  if (!handoff) return undefined
  if (agent.landed !== undefined) return { ...handoff, landed: true }
  if (!handoff.exists) return leftNothing(agent) ? { ...handoff, unchanged: true } : handoff
  // Only a run that began somewhere other than the default branch can carry more than its own
  // work, and only its own branch can be measured again: the extra read is skipped for every
  // other run.
  const carries = agent.baseCommit !== undefined ? await carriedToDefault(cwd, handoff, deps) : undefined
  return carries ? { ...handoff, carries } : handoff
}

/**
 * What a pull request for this run's branch would carry, when that is more than the run's own work
 * ({@link AgentHandoff.carries}).
 *
 * The same read as the handoff's, measured from the project's default branch rather than from the
 * commit the run began at: a run started from a local branch sits on that branch's unlanded commits,
 * and a pull request takes the whole stack. Nothing when the two reads agree — the run started from
 * the default branch after all — and nothing when the branch cannot be measured against it.
 */
async function carriedToDefault(cwd: string, own: AgentHandoff, deps: AgentHandoffDeps): Promise<AgentHandoff['carries']> {
  const branches = await (deps.branches ?? projectBranches)(cwd).catch(() => undefined)
  if (!branches) return undefined
  const [state] = await branches.show([own.branch]).catch(() => [])
  if (!state?.exists || state.base === undefined) return undefined
  const insertions = state.files.reduce((sum, file) => sum + file.insertions, 0)
  const deletions = state.files.reduce((sum, file) => sum + file.deletions, 0)
  if (state.files.length === own.files.length && insertions === own.insertions && deletions === own.deletions) return undefined
  return { base: state.base, commits: state.commits.length, files: state.files.length, insertions, deletions }
}

/**
 * What a handoff action did. The PR's `number` rides along with its `url` (E6), because the number
 * is the fact worth *recording* — every surface that wants an agent's PR then reads it off the agent
 * rather than re-deriving it later.
 */
export type HandoffResult = { ok: true; url?: string; number?: number } | { ok: false; error: string }

/**
 * Open a PR for a branch: the two providers composed (#1820). The branches provider pushes the
 * branch (`push --branch`), then the git host provider opens its request (`open --branch`); the
 * request's base is the git host's. A branch that already has an open request is answered as it is.
 * The branch has a PR now, so the cached "no PR" must go or the bar would keep offering to open
 * one for the next minute (#1028) — both caches: the single-PR view and the history.
 */
async function publishBranch(cwd: string, branch: string, draft: { title: string; body: string; draft?: boolean }, branches: BranchesFor, gitHost: GitHostFor): Promise<HandoffResult> {
  const source = await branches(cwd).catch(() => undefined)
  if (!source) return { ok: false, error: 'this project has no branches provider to push with' }
  const gitHostSource = await gitHost(cwd).catch(() => undefined)
  if (!gitHostSource) return { ok: false, error: 'this project has no git host package to open a pull request with' }
  const pushed = await source.push(branch)
  if (!pushed.ok) return { ok: false, error: pushed.error }
  const opened = await gitHostSource.open(branch, { title: draft.title, body: draft.body, ...(draft.draft ? { draft: true } : {}) })
  if (!opened.ok) return { ok: false, error: opened.error }
  forgetPr(cwd, branch)
  forgetBranchPrs(cwd, branch)
  return { ok: true, url: opened.request.url, number: opened.request.number }
}

/**
 * Push a finished session's branch (#1820): the last step where the project has no git host, or the
 * step a person wants on its own. The branches provider pushes it under its clean rule; a branch
 * only the remote has is already there. Refuses a session that recorded no branch.
 */
export async function pushAgentBranch(cwd: string, agent: Pick<AgentMeta, 'id' | 'branch'>, deps: { branches?: BranchesFor } = {}): Promise<HandoffResult> {
  const branch = agentBranchFor(agent)
  if (branch === undefined) return { ok: false, error: 'this session recorded no branch to push' }
  const source = await (deps.branches ?? projectBranches)(cwd).catch(() => undefined)
  if (!source) return { ok: false, error: 'this project has no branches provider to push with' }
  const pushed = await source.push(branch)
  return pushed.ok ? { ok: true } : { ok: false, error: pushed.error }
}

/**
 * Merge a finished session's branch into the project's default branch, on this machine: how the
 * work reaches the project's own folder where there is no remote to push to. The branches provider
 * merges and deletes the branch; the session's record then keeps the branch's last commit and the
 * commit its work began at, so what it changed is still read once the branch is gone.
 */
export async function mergeAgentBranch(cwd: string, agent: Pick<AgentMeta, 'id' | 'branch'>, deps: { branches?: BranchesFor; runs?: RunsFor } = {}): Promise<HandoffResult> {
  const branch = agentBranchFor(agent)
  if (branch === undefined) return { ok: false, error: 'this session recorded no branch to merge' }
  const source = await (deps.branches ?? projectBranches)(cwd).catch(() => undefined)
  if (!source) return { ok: false, error: 'this project has no branches provider to merge with' }
  const merged = await source.merge(branch)
  if (!merged.ok) return { ok: false, error: merged.error }
  if (!merged.deleted) return { ok: true }
  const runs = await (deps.runs ?? projectRuns)(cwd).catch(() => undefined)
  const recorded = await runs?.patch(agent.id, { landed: { commit: merged.commit, from: merged.from } })
  // The merge is in whatever the record says; a record that could not be written is said, since the page reads the record.
  if (recorded && !recorded.ok) return { ok: false, error: `merged into ${merged.into}, but the record was not updated: ${recorded.error}` }
  return { ok: true }
}

/**
 * Open a draft PR for a branch that exists only on the remote (#1601): a cloud session's own
 * `claude/*` branch was pushed from a VM this machine never sees, so there is nothing to push
 * here — the provider publishes the branch as the remote has it. Draft because a PR
 * OpenAgent opens by itself must not put a review request in anyone's inbox, and the
 * interventions queue keeps listing a session's draft.
 */
export async function openRemoteBranchPullRequest(
  cwd: string,
  agent: HandoffAgent,
  branch: string,
  deps: { branches?: BranchesFor; gitHost?: GitHostFor } = {},
): Promise<HandoffResult> {
  return publishBranch(cwd, branch, { title: agentPrTitle(agent), body: agentPrBody(agent), draft: true }, deps.branches ?? projectBranches, deps.gitHost ?? projectGitHost)
}

/**
 * Whether the session kept committing after its PR merged or closed (#1512): the PR carries a
 * head, the branch has a tip, and they disagree. False for an open PR (pushed commits still land
 * on it), for a headless read (an older cache or injected lookup — never risk a duplicate PR on
 * a guess), and for a gone branch (no tip to compare; the PR stays the best answer, #1255).
 */
function movedPastPr(state: Pick<AgentHandoff, 'pr' | 'commits'>): boolean {
  if (!state.pr || state.pr.state === 'OPEN') return false
  const tip = state.commits[0]?.sha
  return Boolean(state.pr.headRefOid && tip && state.pr.headRefOid !== tip)
}

/**
 * Whether the branch holds commits on top of the head of its merged or closed PR: what the bar
 * offers the next pull request on. Narrower than {@link movedPastPr}, which a person's click is
 * checked by: a PR whose head the branch does not build on was updated on the git host, and the
 * branch here has nothing that PR did not land. Asked of git rather than read off the commits,
 * which no longer hold the PR's head once it is merged and the default branch is fetched.
 */
async function commitsPastPr(cwd: string, pr: LinkedPr | undefined, commits: HandoffCommit[], git: GitRunner = nodeGitRunner()): Promise<boolean> {
  const tip = commits[0]?.sha
  const head = pr?.headRefOid
  if (!pr || pr.state === 'OPEN' || !head || !tip || head === tip) return false
  return git(['merge-base', '--is-ancestor', head, tip], cwd).then(() => true, () => false)
}

/**
 * Open a PR for a finished session, deciding from what the agent recorded which cases should not
 * open one. Reads the branch's handoff first: a branch that no longer exists, or a session that
 * changed nothing, is a clear error rather than an empty PR, and a branch that already has a PR
 * returns that one. Title is its branch, else the id; body is the intent, plus which session did it. This is the handoff decision the
 * dashboard's open-PR button offers; the RPC layer only resolves which run it is about, and the
 * two providers do the pushing and the opening.
 */
export async function openAgentPullRequest(
  cwd: string,
  agent: AgentMeta,
  options: { draft?: boolean; branches?: BranchesFor; gitHost?: GitHostFor; pr?: BranchPrLookup } = {},
): Promise<HandoffResult> {
  // A subagent's work goes to its main agent's branch, and that one opens the pull request.
  if (agent.parent !== undefined) return { ok: false, error: 'this run is a subagent: its main agent lands its work and opens the pull request' }
  const branch = agentBranchFor(agent)
  if (branch === undefined) return { ok: false, error: 'this session recorded no branch to open a PR from' }
  const branches = options.branches ?? projectBranches
  const gitHost = options.gitHost ?? projectGitHost
  // `latest` order (#1512), because the `movedPastPr` decision below compares the branch tip
  // against a PR's head: against the *first* PR, work a second one already landed reads as
  // unlanded and this opens a third for it.
  const handoff = await readAgentHandoff(cwd, branch, { since: agent.startedAt, order: 'latest', branches, gitHost, ...(options.pr ? { pr: options.pr } : {}), ...(agent.baseCommit !== undefined ? { from: agent.baseCommit } : {}) }).catch(() => undefined)
  // The agent's PR first, even when its branch is gone locally: a hands-off web agent's branch only
  // ever existed on the remote, and its PR is the answer the button exists to give (#1255).
  // Unless the session demonstrably kept committing after that PR merged or closed (#1512) —
  // then the old PR is not the answer, the new work needs its own.
  if (handoff?.pr && !movedPastPr(handoff)) return { ok: true, url: handoff.pr.url, number: handoff.pr.number }
  if (handoff && !handoff.exists) return { ok: false, error: `branch ${branch} no longer exists` }
  // Refuse rather than open an empty PR: a session that changed nothing has nothing to hand off.
  if (handoff?.empty) return { ok: false, error: 'this session produced no commits to open a PR for' }
  // Its commits are still counted once the default branch has them, from where its work began: nothing is left to open one for.
  if (handoff?.merged) return { ok: false, error: 'this session’s work is already merged' }
  return publishBranch(cwd, branch, { title: agentPrTitle(agent, handoff?.name), body: agentPrBody(agent), ...(options.draft ? { draft: true } : {}) }, branches, gitHost)
}

/**
 * The little a handoff needs to know about the agent it is for: which branch, and what to say on
 * the PR. Narrower than {@link AgentMeta} so a caller cannot quietly start depending on the rest
 * of the agent's state.
 */
export type HandoffAgent = Pick<AgentMeta, 'id' | 'branch' | 'intent'> & Partial<Pick<AgentMeta, 'startedAt'>>

/**
 * The PR title for a session (#1102).
 *
 * Two rungs, each a name for the work the session did: the branch the agent named its work with
 * (#1725), else the session id — which says little, but says it honestly. An agent that publishes
 * its own work titles its own PR; this is only the title of one a person opens for it.
 *
 * The prompt the session was given is not among them. It used to be, cut to 72 characters, and a
 * squash merge made that permanent: `main` ended up carrying instructions truncated mid-sentence
 * as commit subjects, which describe neither what changed nor even a whole thought (#1618).
 */
function agentPrTitle(agent: Pick<HandoffAgent, 'id' | 'branch'>, name?: string): string {
  // The name the branches provider answers for the branch comes before the branch itself:
  // OpenAgent draws the name it is given and never cuts the package's prefix off a branch.
  return name ?? agent.branch ?? `Session ${agent.id}`
}

/**
 * The PR body: what was asked for, which is all OpenAgent knows on its own, and which session
 * did it.
 */
function agentPrBody(agent: HandoffAgent): string {
  const lines: string[] = []
  const opening = agent.intent?.trim()
  if (opening) lines.push(opening, '')
  lines.push(`Opened from OpenAgent session \`${agent.id}\`.`)
  return lines.join('\n')
}

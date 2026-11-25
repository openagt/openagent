import { hostname } from 'node:os'
import type { AgentMeta } from '../store/index.js'
import { projectBranches, type BranchesFor } from '../store/branches.js'
// What a finished session produced (#799), for the bar above its message box: whether it has
// something to say, and when it is over.
//
// The read is deliberately *branch*-addressed, not worktree-addressed: the common end state has
// no worktree left, so a checkout-based read (`onAgentWorktree`) falls back to the project root and
// reports the project's own branch as if it were the session's. Here the branch is the subject and
// the project repo is only where it is read from, so a finished session reads the same whether or
// not its checkout still exists.
//
// The branch's git facts are the project's branches provider's (#1774), and its next steps, a
// pull request among them, are the modules' (`chat.handoff`). Forgiving throughout: a project with
// no branches provider or no remote yields a handoff with less in it, never an error.

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
  /**
   * A session's copy of a repo with no remote: the folder it was copied from, where its work goes
   * back to ({@link bringAgentBranch}), and whether that folder has the branch already.
   */
  copiedFrom?: { path: string; hasBranch: boolean }
}

/** Injectable seams so the reader is unit-testable off disk and off the provider. */
export interface AgentHandoffDeps {
  /** The project's checkouts and branches (default the project's provider, {@link projectBranches}). */
  branches?: BranchesFor
  /** The commit the run's own work begins at ({@link AgentMeta.baseCommit}): what the branch is measured from. */
  from?: string
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
 * Read what a finished session left behind, for `branch`: the branch's git facts from the
 * project's branches provider.
 *
 * Returns undefined only when the project has no branches provider, or the provider did not
 * answer for the branch. A branch that no longer exists still returns a handoff (with
 * `exists: false`), because "that branch is gone" is itself the answer the dashboard needs to
 * show.
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
    ...(state.pendingFiles ? { pendingFiles: state.pendingFiles } : {}),
    ...(state.copiedFrom ? { copiedFrom: state.copiedFrom } : {}),
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
  agent: Pick<AgentMeta, 'id' | 'branch' | 'baseCommit' | 'landed' | 'status' | 'host' | 'pr'>,
  deps: AgentHandoffDeps = {},
): Promise<AgentHandoff | undefined> {
  const at = agent.branch ?? agent.landed
  if (at === undefined) return undefined
  const handoff = await readAgentHandoff(cwd, at, { ...(agent.baseCommit !== undefined ? { from: agent.baseCommit } : {}), ...deps })
  if (!handoff) return undefined
  if (agent.landed !== undefined) return { ...handoff, landed: true }
  return !handoff.exists && leftNothing(agent) ? { ...handoff, unchanged: true } : handoff
}

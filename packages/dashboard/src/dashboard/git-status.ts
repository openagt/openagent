import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { cachedPrView, cachedPrsForBranch, pickAgentPr, type LinkedPr, type PrLookup } from './pull-requests.js'

// The project panel's git status (#491, part of #488): the active branch, whether the tree is
// dirty, and the linked PR. Branch + dirty are a local git read; the PR is a best-effort read
// through the project's git host that simply degrades to nothing when the project has no git host or
// there is no PR. Safe anywhere — the relay has no local checkout, so it resolves to nothing there.

/** A project's git status for the panel. */
export interface GitStatus {
  branch: string
  /** Uncommitted changes present. */
  dirty: boolean
  pr?: LinkedPr
  /** The PR is not known yet, rather than absent (#1028): the lookup is still running. */
  prPending?: boolean
}

/** Injectable seams so {@link readGitStatus} is unit-testable off disk. */
export interface GitStatusDeps {
  git?: GitRunner
  pr?: PrLookup
  /**
   * The agent's start, when the status is read for an agent's checkout (#1255). The default lookup
   * answers the newest PR for the branch *in any state* — so an agent on a reused pinned branch
   * (`openagent/triage-quick`) wears a predecessor's merged PR as its own badge.
   * With `since` set the PR is picked from the branch's whole history by {@link pickAgentPr}
   * instead: an open PR, or a closed one no older than the agent itself.
   */
  since?: string
  /** The branch's full PR history, for the {@link GitStatusDeps.since} path (default {@link cachedPrsForBranch}). */
  prs?: (cwd: string, branch: string) => Promise<LinkedPr[]>
  /**
   * The project's folder, for a status read in a run's checkout: the branch's PR history is looked
   * up and cached by it, as the run's handoff reads it, so the lookup the bar made while the run
   * worked is warm once the run ends and its Open PR is asked about.
   */
  prRoot?: string
}

/**
 * The branch `cwd` has checked out, by its short name; `HEAD` when it is on no branch. Undefined
 * when `cwd` is not a git repo, or git failed.
 */
export async function currentBranch(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).then(out => out.trim(), () => undefined)
}

/**
 * Read a project's git status: the current branch and dirty flag (from git), plus the linked
 * PR (best-effort). Returns undefined when the path is not a git repo. Forgiving — a failed
 * `git status` reads as clean, and a failed PR lookup simply omits the PR.
 */
export async function readGitStatus(cwd: string, deps: GitStatusDeps = {}): Promise<GitStatus | undefined> {
  const git = deps.git ?? nodeGitRunner()
  const branch = await currentBranch(cwd, git)
  if (branch === undefined) return undefined // not a git repo (or git failed)
  const dirty = (await git(['status', '--porcelain'], cwd).catch(() => '')).trim().length > 0
  // The branch and the dirty flag are what this row is for, and they are ten milliseconds of git.
  // The PR is a git host read an order of magnitude slower, so it is read through the cache and is
  // allowed to arrive late (#1028) rather than holding the whole row back on every poll.
  const pr = await linkedPr(cwd, branch, deps)
  return { branch, dirty, ...(pr.value ? { pr: pr.value } : {}), ...(pr.pending ? { prPending: true } : {}) }
}

/** The PR half of the status: the injected seam, the run-scoped history pick, or the plain view. */
async function linkedPr(
  cwd: string,
  branch: string,
  deps: GitStatusDeps,
): Promise<{ value: LinkedPr | undefined; pending: boolean }> {
  if (deps.pr) return { value: await deps.pr(cwd).catch(() => undefined), pending: false }
  if (deps.since === undefined) return cachedPrView(cwd, branch).catch(() => ({ value: undefined, pending: false }))
  if (deps.prs) return { value: pickAgentPr(await deps.prs(cwd, branch).catch(() => []), deps.since), pending: false }
  return cachedPrsForBranch(deps.prRoot ?? cwd, branch).then(
    read => ({ value: pickAgentPr(read.value ?? [], deps.since), pending: read.pending }),
    () => ({ value: undefined, pending: false }),
  )
}

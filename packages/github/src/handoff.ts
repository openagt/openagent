import { nodeGitRunner, readBranchStates, readHandoff, workAt, type Handoff, type HandoffCommit, type WorkAt } from '@openagt/git-branches'
import type { GitRunner, RunFound } from '@openagt/hooks'
import { homeUrlFor } from './home.js'
import { cachedPrsForBranch, forgetBranchPrs, forgetPr, pickAgentPr, prsForBranchOrThrow, projectGitHost, type GitHostFor, type LinkedPr } from './pulls.js'

// The pull request of an ended run's work (#799), in the bar above its message box: which of its
// branch's requests is the run's, and what the bar offers for it. The branch's own facts are
// git-branches' (`readHandoff`); the requests are GitHub's, read here. What this decides is about
// the run: when an existing request is the answer and when a new one is, and what a new one says.
//
// Once a request exists it is not offered again: the bar names it, and what waits on the person
// lists it. What is offered is what it still needs: the push of commits it does not have, and its
// merge. Work committed after it merged or closed is offered the next one.

/** What the bar offers for a run's pull request now; nothing of it when nothing is to be done with one. */
export interface PrHandoff {
  /** The run's request, when it has one this read could tell. */
  pr?: LinkedPr
  /** A request can be opened for the branch: it has work no request has, on GitHub, all of it committed. */
  open?: {
    /** The branch is on origin as it is here: opening it pushes nothing. */
    pushed: boolean
    branch: string
    /** What a request into the default branch would carry beyond the run's own work: a run started from another branch rides on that branch's work. */
    carries?: Carries
  }
  /** The request is open, and the branch has commits it does not: they are pushed first. */
  update?: true
  /** The request is open and can be merged. */
  merge?: true
  /** The request merges by itself once its checks pass. */
  armed?: true
}

/** What a pull request against the default branch would carry, beyond the run's own work. */
export interface Carries {
  base: string
  commits: number
  files: number
  insertions: number
  deletions: number
}

/** What is read for a run's request: where its work is, what its branch holds, its request, and whether the branch kept going past a merged or closed one. */
export interface PrRead {
  at: WorkAt
  handoff: Handoff
  pr?: LinkedPr
  movedPast: boolean
  onGithub: boolean
  /** GitHub did not answer for the branch's requests: whether it has one is not known. */
  unread?: true
}

/** What the reads go through; the real ones when absent. */
export interface PrDeps {
  gitHost?: GitHostFor
  git?: GitRunner
  /** What a branch holds, as git-branches reads it. */
  branch?: (at: WorkAt) => Promise<Handoff | undefined>
  /** Whether the repository at `cwd` is on GitHub. */
  onGithub?: (cwd: string) => Promise<boolean>
  /** Read the branch's requests from GitHub now, and throw where it cannot tell: a press about to open one must not take "could not tell" for "none". */
  fresh?: true
}

/** Whether the run's record says it works: its card says `running` while its process does. */
export function isWorking(status: string | undefined): boolean {
  return status === 'running' || status === 'working'
}

/**
 * The run's request and what its branch holds, in the project at `root` or in its copy `repo`.
 * The run's own request first: the one its record names (read live for its state), else the first
 * of its branch's requests a run that started when it did opened ({@link pickAgentPr}); whether
 * the branch kept going is asked of the latest, the one that last saw it. None for a run with
 * neither a branch nor a landed commit.
 */
export async function readRunPr(root: string, agentId: string, run: RunFound | undefined, repo: string | undefined, deps: PrDeps = {}): Promise<PrRead | undefined> {
  const at = await workAt(root, agentId, run, repo)
  if (!at) return undefined
  const handoff = await (deps.branch ?? readHandoff)(at).catch(() => undefined)
  if (!handoff) return undefined
  const onGithub = await (deps.onGithub ?? (async cwd => (await homeUrlFor(cwd).catch(() => undefined)) !== undefined))(at.cwd)
  const record = run?.record
  const branch = at.branch
  const asked = onGithub && branch !== undefined ? await requestsOf(at.cwd, branch, record?.endedAt, deps) : []
  const listed = asked ?? []
  // A copy's request is on no record: the one its branch has is the copy's.
  const recorded = repo === undefined ? record?.pr : undefined
  const live = recorded ? listed.find(pr => pr.number === recorded.number) : undefined
  const pr = recorded ? (live ?? { ...recorded, state: 'UNKNOWN', title: '' }) : pickAgentPr(listed, record?.startedAt)
  const latest = pickAgentPr(listed, record?.startedAt, 'latest') ?? pr
  const movedPast = await commitsPast(at.cwd, latest, handoff.commits, deps.git)
  return { at, handoff, ...(pr ? { pr } : {}), movedPast, onGithub, ...(asked === undefined ? { unread: true as const } : {}) }
}

/**
 * The branch's requests, through the cache (`cache.ts`): an answer still out is waited for, since
 * acting on "not known yet" is how a second request gets opened, and one read before the run ended
 * is read again, since it cannot know of a request the run opened on its way out. None when GitHub
 * did not answer: "could not tell" is never "no requests".
 */
async function requestsOf(cwd: string, branch: string, endedAt: string | undefined, deps: PrDeps): Promise<LinkedPr[] | undefined> {
  const gitHost = deps.gitHost ?? projectGitHost
  if (deps.fresh) return prsForBranchOrThrow(cwd, branch, gitHost)
  // Waited for through the cache, so what it reads is kept for the next ask: a read of its own
  // here would leave the cache empty and every ask paying GitHub's second again.
  const cached = await cachedPrsForBranch(cwd, branch, gitHost, { wait: true }).catch(() => undefined)
  const ended = endedAt !== undefined ? Date.parse(endedAt) : NaN
  const stale = cached?.at !== undefined && Number.isFinite(ended) && cached.at < ended
  if (cached?.value !== undefined && !stale) return cached.value
  forgetRequests(cwd, branch)
  return (await cachedPrsForBranch(cwd, branch, gitHost, { wait: true }).catch(() => undefined))?.value
}

/**
 * Whether the branch holds commits on top of the head of its merged or closed request: what the
 * next request is offered on. Asked of git rather than read off the commits, which no longer hold
 * the request's head once it is merged and the default branch is fetched.
 */
async function commitsPast(cwd: string, pr: LinkedPr | undefined, commits: HandoffCommit[], git: GitRunner = nodeGitRunner()): Promise<boolean> {
  const tip = commits[0]?.sha
  const head = pr?.headRefOid
  if (!pr || pr.state === 'OPEN' || !head || !tip || head === tip) return false
  return git(['merge-base', '--is-ancestor', head, tip], cwd).then(
    () => true,
    () => false,
  )
}

/**
 * What the bar offers for the run's request, from what was read. Work left uncommitted comes
 * first, git-branches' Commit: a push or a request would be refused while the checkout is unclean.
 * A branch with no diff, gone, already merged, with no remote, or not on GitHub has no request to
 * open; what is said of each is git-branches'. Nor has one whose requests GitHub did not list.
 */
export async function prHandoffOf(read: PrRead | undefined, carriesOf: (read: PrRead) => Promise<Carries | undefined> = carriedToDefault): Promise<PrHandoff> {
  if (!read) return {}
  const { handoff, pr, movedPast } = read
  if (handoff.landed || (handoff.pendingFiles?.length ?? 0) > 0) return pr ? { pr } : {}
  if (pr && !movedPast) {
    if (pr.state !== 'OPEN' || handoff.merged) return { pr }
    if (pr.armed) return { pr, armed: true }
    // Only where the request's own head is an earlier commit of this branch: a branch that differs
    // from origin because the request was updated on GitHub has nothing to push.
    if (!handoff.pushed && handoff.commits.slice(1).some(commit => commit.sha === pr.headRefOid)) return { pr, update: true }
    return { pr, merge: true }
  }
  if (!handoff.exists || handoff.empty || handoff.merged || !handoff.hasRemote || !read.onGithub) return pr ? { pr } : {}
  // GitHub did not say whether the branch has a request: offering to open one could be offering a second.
  if (read.unread) return pr ? { pr } : {}
  const carries = await carriesOf(read).catch(() => undefined)
  return { ...(pr ? { pr } : {}), open: { pushed: handoff.pushed, branch: handoff.branch, ...(carries ? { carries } : {}) } }
}

/**
 * What a request for the branch would carry beyond the run's own work: the branch measured against
 * the default branch, for a run started from another one (its work is measured from the commit it
 * began at). Nothing when both measures agree, or the branch cannot be measured.
 */
async function carriedToDefault({ at, handoff }: PrRead): Promise<Carries | undefined> {
  if (at.from === undefined || at.branch === undefined) return undefined
  const [state] = await readBranchStates(at.cwd, [at.branch])
  if (!state?.exists || state.base === undefined) return undefined
  const insertions = state.files.reduce((sum, file) => sum + file.insertions, 0)
  const deletions = state.files.reduce((sum, file) => sum + file.deletions, 0)
  if (state.files.length === handoff.files.length && insertions === handoff.insertions && deletions === handoff.deletions) return undefined
  return { base: state.base, commits: state.commits.length, files: state.files.length, insertions, deletions }
}

/** A request changed here (opened, merged): what was read of the branch's requests is read again. */
export function forgetRequests(cwd: string, branch: string | undefined): void {
  forgetPr(cwd, branch)
  if (branch !== undefined) forgetBranchPrs(cwd, branch)
}

/**
 * The title and body of a request a person opens for a run, saying what the request does rather
 * than what the run was asked: a scheduled run is asked `/work-queue`, which a reviewer cannot read
 * anything from. One commit is the request, as GitHub fills one in itself: its subject the title,
 * the rest of its message the body, which carries the `Closes …` lines the agent wrote. Several are
 * listed, oldest first, under the name the branch was given. A message git cannot read leaves the
 * subject alone.
 */
export async function requestText(cwd: string, agentId: string, handoff: Handoff, git: GitRunner = nodeGitRunner()): Promise<{ title: string; body: string }> {
  const footer = `Opened from OpenAgent session \`${agentId}\`.`
  const only = handoff.commits.length === 1 ? handoff.commits[0]! : undefined
  if (!only) {
    const listed = [...handoff.commits].reverse().map(commit => `- ${commit.subject}`)
    // The name the branch was given before the branch itself, which OpenAgent never cuts a prefix off.
    return { title: handoff.name ?? handoff.branch, body: [...listed, '', footer].join('\n') }
  }
  const message = await git(['log', '-1', '--format=%B', only.sha], cwd).catch(() => '')
  // Past the subject, less the co-author lines: the request names its author itself.
  const rest = message
    .split('\n')
    .slice(1)
    .filter(line => !/^co-authored-by:/i.test(line))
    .join('\n')
    .trim()
  return { title: only.subject, body: [...(rest ? [rest, ''] : []), footer].join('\n') }
}

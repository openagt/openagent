import { projectGitHost, type GitHostFor, type GitHostRequest } from '../store/git-host.js'
import { cachedRead, invalidate, type Cached } from './cache.js'

/**
 * The pull requests the dashboard reads (#1820), in one place, all through the project's git host
 * provider (`../store/git-host.ts`): a branch's request, a branch's whole request history, and the
 * project's open requests. Reads only: opening and landing are `agent-handoff.ts`'s, through the
 * same provider. OpenAgent runs no git host tool; a project with no git host package has no pull
 * requests, and every read here answers "none" for it.
 *
 * The shapes are OpenAgent's own ({@link LinkedPr}, {@link OpenPr}), copied out of what the
 * provider answers rather than passed through, so a field a provider adds cannot leak into what
 * callers store.
 */

/** The PR opened for a branch, when there is one. */
export interface LinkedPr {
  number: number
  url: string
  /** OPEN / MERGED / CLOSED, as the git host reports it; UNKNOWN for a recorded request no live read confirmed. */
  state: string
  title: string
  /** ISO creation time, when the read included it: what tells one agent's PR from a predecessor's. */
  createdAt?: string
  /**
   * The head commit the PR covers, when the read included it (#1512): what tells "the branch's
   * PR already landed everything" from "the session kept working after its PR merged".
   */
  headRefOid?: string
  /** The commit a merged PR landed as on the base branch, when the git host said. */
  mergeCommit?: string
}

/** An open PR on the interventions queue (#632). */
export interface OpenPr {
  number: number
  title: string
  url: string
  /**
   * Draft PRs are generally left off the queue: a draft is not asking for review.
   *
   * The exception is a draft OpenAgent opened for itself (#1102), which {@link headRefName}
   * is what tells apart.
   */
  isDraft: boolean
  /** The branch the PR is from, so a session's own PR can be recognised as ours (#1102). */
  headRefName?: string
  createdAt?: string
}

/**
 * A best-effort PR lookup, for a named branch or for the checkout's current branch. One type for
 * both: the named-branch form is the general one, and "the current branch" is just omitting it.
 */
export type PrLookup = (cwd: string, branch?: string) => Promise<LinkedPr | undefined>

/**
 * The branch-addressed form, for a caller that always names one (#799): a finished session's
 * worktree may be gone, so "the current branch" would silently be the project's, not the
 * session's. Narrower than {@link PrLookup} on purpose, so that invariant is in the type.
 */
export type BranchPrLookup = (cwd: string, branch: string) => Promise<LinkedPr | undefined>

/** Lists a checkout's open PRs; rejects when the git host could not answer. */
export type PrLister = (cwd: string) => Promise<OpenPr[]>

/** A provider's request as OpenAgent keeps it: the state upper-cased, the head as the request's commit. */
export function linkedPrOf(request: GitHostRequest): LinkedPr {
  return {
    number: request.number,
    url: request.url,
    state: request.state.toUpperCase(),
    title: request.title,
    ...(request.createdAt ? { createdAt: request.createdAt } : {}),
    ...(request.head ? { headRefOid: request.head } : {}),
    ...(request.mergeCommit ? { mergeCommit: request.mergeCommit } : {}),
  }
}

/** A provider's open request as the interventions queue keeps it. */
export function openPrOf(request: GitHostRequest): OpenPr {
  return {
    number: request.number,
    title: request.title,
    url: request.url,
    isDraft: request.draft,
    ...(request.branch ? { headRefName: request.branch } : {}),
    ...(request.createdAt ? { createdAt: request.createdAt } : {}),
  }
}

/**
 * Every PR a branch name has ever had, newest first (#1251).
 *
 * The newest request for a head *in any state* is what a single view would answer, so a session
 * whose prompt pins its branch name (`openagent/triage-quick`) inherits a predecessor's
 * merged PR as its own. The list form keeps the whole history so {@link pickAgentPr} can decide
 * which entry, if any, belongs to the agent asking. Resolves `[]` when the project has no git host or
 * the git host could not answer — indistinguishable from "no PRs", which is what every caller would do
 * with a failure anyway.
 */
export async function prsForBranch(cwd: string, branch: string, gitHost: GitHostFor = projectGitHost): Promise<LinkedPr[]> {
  return prsForBranchOrThrow(cwd, branch, gitHost).catch((): LinkedPr[] => [])
}

/**
 * {@link prsForBranch} for a caller about to *open* a PR (#1601): a listing the git host could not
 * answer throws instead of reading as "no PRs", because "none" and "could not tell" must not look
 * alike there — the difference is a second draft PR on a branch that already has one. A project
 * with no git host has none, truthfully.
 */
export async function prsForBranchOrThrow(cwd: string, branch: string, gitHost: GitHostFor = projectGitHost): Promise<LinkedPr[]> {
  const source = await gitHost(cwd)
  if (!source) return []
  const listed = await source.requests({ branch, state: 'all' })
  if (!listed.ok) throw new Error(listed.error)
  return listed.requests.map(linkedPrOf)
}

/** The newest PR of `branch`, in any state, or undefined when it has none or the git host cannot tell. */
export async function prView(cwd: string, branch: string, gitHost: GitHostFor = projectGitHost): Promise<LinkedPr | undefined> {
  return (await prsForBranch(cwd, branch, gitHost))[0]
}

/**
 * The cached form of {@link prView} (#1028), and what the dashboard's panels use.
 *
 * A PR lookup costs a process where the git reads beside it cost ten milliseconds, and the answer
 * changes about as often as someone opens a PR. Cached per checkout and branch, shared between
 * the worktree bar and the handoff summary, and refreshed behind whoever asks. `pending` says the
 * answer is not known yet rather than that there is no PR — the difference matters to a caller
 * deciding whether to offer "Open PR". A read with no branch to ask about answers nothing at once.
 */
export async function cachedPrView(cwd: string, branch?: string): Promise<Cached<LinkedPr | undefined>> {
  if (branch === undefined) return { value: undefined, pending: false }
  return cachedRead(prCacheKey(cwd, branch), () => prView(cwd, branch))
}

/** Forget a branch's PR, after an action that changes whether it has one, and with it how the project's PRs stand. */
export function forgetPr(cwd: string, branch?: string): void {
  invalidate(prCacheKey(cwd, branch))
  invalidate(prStatesCacheKey(cwd))
}

/** How a run's pull request stands, as its row in the list of runs shows it. */
export type PrState = 'open' | 'draft' | 'merged' | 'closed'

/**
 * How each of a project's newest pull requests stands, by number: what the list of runs marks
 * each run's PR with. One listing of the project's requests, whatever their state, rather than one
 * per run; a request older than what the git host lists has no state here. A listing the git host
 * cannot answer throws, so the cache keeps the states it last had.
 */
export async function prStates(cwd: string, gitHost: GitHostFor = projectGitHost): Promise<Map<number, PrState>> {
  const source = await gitHost(cwd)
  if (!source) return new Map()
  const listed = await source.requests({ state: 'all' })
  if (!listed.ok) throw new Error(listed.error)
  return new Map(listed.requests.map(request => [request.number, request.state === 'open' && request.draft ? 'draft' : request.state]))
}

/** The cached form of {@link prStates} (#1028): the list of runs is polled, and a PR's state changes far less often. Nothing yet known reads as no states. */
export async function cachedPrStates(cwd: string): Promise<Map<number, PrState>> {
  const read = await cachedRead(prStatesCacheKey(cwd), () => prStates(cwd)).catch(() => undefined)
  return read?.value ?? new Map()
}

/** The cached form of {@link prsForBranch}, shared through the same read-through cache (#1028). */
export async function cachedPrsForBranch(cwd: string, branch: string): Promise<Cached<LinkedPr[]>> {
  return cachedRead(branchPrsCacheKey(cwd, branch), () => prsForBranch(cwd, branch))
}

/** Forget a branch's PR history, after an action that changes it (opening one). */
export function forgetBranchPrs(cwd: string, branch: string): void {
  invalidate(branchPrsCacheKey(cwd, branch))
}

/** An unprintable separator, so paths cannot collide with the keys. */
const KEY_SEP = String.fromCharCode(0)

function prCacheKey(cwd: string, branch?: string): string {
  return ['pr', cwd, branch ?? ''].join(KEY_SEP)
}

function prStatesCacheKey(cwd: string): string {
  return ['pr-states', cwd].join(KEY_SEP)
}

function branchPrsCacheKey(cwd: string, branch: string): string {
  return ['prs', cwd, branch].join(KEY_SEP)
}

/**
 * The PR that belongs to an agent, out of every PR its branch name has had (#1251/#1255).
 *
 * An OPEN PR always counts: a git host allows one open PR per head branch, so whatever is open on the
 * run's branch is where its pushed commits land. A closed one counts only when it was created
 * after the agent started (`since`, the agent's `startedAt`) — the oldest such entry, which is the one
 * this agent's handoff opened. Anything older is a previous agent's PR wearing the same branch name,
 * which is exactly what showed a merged two-day-old PR as a fresh session's own. Without `since`
 * only an open PR is trusted.
 *
 * `order` exists for the one caller asking a different question (#1512). `'first'` answers
 * identity — which PR did *this agent* open, so a later agent's must not be the answer. `'latest'`
 * answers the handoff decision — which PR last saw the branch, so "did the session keep working
 * past it" is readable off that PR's `headRefOid`; there the oldest entry would call work that a
 * second PR already landed unlanded.
 */
export function pickAgentPr(prs: LinkedPr[], since?: string, order: 'first' | 'latest' = 'first'): LinkedPr | undefined {
  const open = prs.find(pr => pr.state === 'OPEN')
  if (open) return open
  if (!since) return undefined
  const closed = prs
    .filter(pr => pr.createdAt && pr.createdAt >= since)
    .sort((a, b) => ((a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1))
  return order === 'latest' ? closed.at(-1) : closed[0]
}

/**
 * A project's open PRs, through its git host. Unlike the other reads here it *rejects* when the git host
 * could not answer — no remote, not logged in, the git host unreachable — instead of resolving `[]`.
 *
 * "No PRs are open" and "I could not look" are different answers, and its caller keeps a baseline
 * of what it has already announced (#1623): taking the second for the first makes the next
 * successful read announce every already-open PR as new. The caller decides what a failure costs;
 * it cannot decide what it never hears about. A project with no git host package has none open.
 */
export async function openPrs(cwd: string, gitHost: GitHostFor = projectGitHost): Promise<OpenPr[]> {
  const source = await gitHost(cwd)
  if (!source) return []
  const listed = await source.requests({ state: 'open' })
  if (!listed.ok) throw new Error(listed.error)
  return listed.requests.map(openPrOf)
}

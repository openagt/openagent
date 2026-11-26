import { cachedRead, invalidate, type Cached } from './cache.js'
import { homeUrlFor } from './home.js'
import { cliAnswer } from './host-accounts.js'
import type { PullRequestRead } from '@openagt/hooks'
import type { MergeLookup } from '@openagt/hooks/rpc'
import type { Request, RequestsQuery } from './requests.js'

/**
 * The pull requests the dashboard reads (#1820), in one place, each asked of GitHub with this
 * package's own `requests`, as the account runs use: a branch's request, a branch's whole request
 * history, and the project's open requests. Reads only: opening and landing are `handoff.ts`'s. A
 * repository that is not on GitHub has no pull requests here, and every read answers "none" for it.
 *
 * The shapes are the dashboard's own ({@link LinkedPr}, {@link OpenPr}), copied out of what
 * `requests` answers rather than passed through, so a field it adds cannot leak into what callers
 * keep.
 *
 * Every read here keeps what it answered of each request as the newest word on it ({@link readRequests}),
 * and every cached read answers each request as that newest word says: a branch's read and the
 * project's listing are cached apart, each on its own clock, and a request merged said "merged"
 * in the session's header and "open" in its sidebar row until the listing's turn came.
 */

/** A pull request as `requests` prints it. */
export type GitHostRequest = Request

/** What a read of requests answered: the requests, or why there are none. */
export type RequestsOutcome = { ok: true; requests: Request[] } | { ok: false; error: string }

/** Where a repository's requests are read; none for a repository that is not on GitHub. */
export interface GitHostSource {
  requests(query: RequestsQuery): Promise<RequestsOutcome>
}

/** The requests of the repository at `cwd`, or none for one that is not on GitHub. */
export type GitHostFor = (cwd: string) => Promise<GitHostSource | undefined>

/** The repository at `cwd`'s requests on GitHub, read with `github requests` in this process; none for a repository that is not on GitHub. */
export const projectGitHost: GitHostFor = async cwd => {
  if ((await homeUrlFor(cwd).catch(() => undefined)) === undefined) return undefined
  return {
    requests: async query => {
      const said = await cliAnswer(['requests', ...(query.branch !== undefined ? [`--branch=${query.branch}`] : []), ...(query.state !== undefined ? ['--state', query.state] : []), ...(query.since !== undefined ? ['--since', query.since] : [])], cwd)
      return said.ok ? { ok: true, requests: Array.isArray(said.output) ? (said.output as Request[]) : [] } : said
    },
  }
}

/** Every request read here, by its address, as the read asked last said it, and that read's turn. */
const newest = new Map<string, { request: GitHostRequest; turn: number }>()

/** The turn of the last read asked: an answer from a read asked earlier never overwrites a later one's, however late it comes. */
let turns = 0

/** Who is told each time a read says a request stands otherwise than the read before it said. */
const moveListeners = new Set<() => void>()

/**
 * Call `listener` each time a read finds a request standing otherwise than it was last read (opened,
 * merged, closed, out of draft), until the answer is called: once for each read, however many it
 * found moved. A request read for the first time moved nowhere.
 */
export function onPrMoved(listener: () => void): () => void {
  const own = (): void => listener()
  moveListeners.add(own)
  return () => void moveListeners.delete(own)
}

/** Ask a project's git host for requests, and keep each one it answered as the newest word on it. */
async function readRequests(source: GitHostSource, query: Parameters<GitHostSource['requests']>[0]): Promise<RequestsOutcome> {
  const turn = ++turns
  const listed = await source.requests(query)
  if (!listed.ok) return listed
  let moved = false
  for (const request of listed.requests) {
    const before = newest.get(request.url)
    if (before && before.turn > turn) continue
    if (before && listedStateOf(before.request) !== listedStateOf(request)) moved = true
    newest.set(request.url, { request, turn })
  }
  if (moved) for (const listener of [...moveListeners]) listener()
  return listed
}

/** How every request read here stands, as the newest read of each says: what the lists of runs mark each run's requests by (`pullRequestsRead`). */
export function requestsRead(): PullRequestRead[] {
  return [...newest.values()].map(({ request }) => ({ url: request.url, state: listedStateOf(request), ...(request.title ? { title: request.title } : {}), ...(request.branch ? { branch: request.branch } : {}) }))
}

/** A request as the newest read says it: the newest word on the same address, else as it was read. */
function newestOf(pr: LinkedPr): LinkedPr {
  const known = newest.get(pr.url)
  return known ? linkedPrOf(known.request) : pr
}

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
  /** The git host will merge it by itself once its checks pass. */
  armed?: true
}

/** An open PR, as what waits on the person lists it (#632). */
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
    ...(request.armed ? { armed: true as const } : {}),
  }
}

/** A provider's open request as the waiting list keeps it. */
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
  const listed = await readRequests(source, { branch, state: 'all' })
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
 * The request is as the newest read of it says, whichever read that was.
 */
export async function cachedPrView(cwd: string, branch?: string, gitHost: GitHostFor = projectGitHost): Promise<Cached<LinkedPr | undefined>> {
  if (branch === undefined) return { value: undefined, pending: false }
  const read = await cachedRead(prCacheKey(cwd, branch), () => prView(cwd, branch, gitHost))
  return read.value ? { ...read, value: newestOf(read.value) } : read
}

/** Forget a branch's PR, after an action that changes whether it has one, and with it how the project's PRs stand and which are open. */
export function forgetPr(cwd: string, branch?: string): void {
  invalidate(prCacheKey(cwd, branch))
  invalidate(prStatesCacheKey(cwd))
  invalidate(openPrsCacheKey(cwd))
}

/** How a run's pull request stands, as its row in the list of runs shows it. */
export type PrState = 'open' | 'draft' | 'merged' | 'closed'

/** A pull request as the project's listing has it: how it stands, and its title. */
export interface ListedPr {
  state: PrState
  title: string
}

/** How a request stands, as its row marks it: an open draft is a draft. */
function listedStateOf(request: GitHostRequest): PrState {
  return request.state === 'open' && request.draft ? 'draft' : request.state
}

/** How the project's requests stand, by address: what {@link cachedPrStates} answers. */
export interface PrStates {
  get(url: string): ListedPr | undefined
}

/**
 * How each of a project's newest pull requests stands, and its title, by its address: what the list
 * of runs marks each run's PR with. One listing of the project's requests, whatever their state,
 * rather than one per run; a request older than what the git host lists has no state here. A
 * listing the git host cannot answer throws.
 */
export async function prStates(cwd: string, gitHost: GitHostFor = projectGitHost): Promise<Map<string, ListedPr>> {
  const source = await gitHost(cwd)
  if (!source) return new Map()
  const listed = await readRequests(source, { state: 'all' })
  if (!listed.ok) throw new Error(listed.error)
  return new Map(listed.requests.map(request => [request.url, { state: listedStateOf(request), title: request.title }]))
}

/**
 * The cached form of {@link prStates} (#1028): the list of runs is polled every few seconds, and a
 * PR's state changes far less often. Each request stands as the newest read of it says, the
 * listing's or a branch's, so a row says "merged" with its session's header and not a minute after.
 * A listing that fails is kept like an answer, so a git host that cannot answer is asked again a
 * minute later, not at every poll; and while a read is on its way, after a request was opened or
 * merged here, the rows keep the states they had.
 */
export async function cachedPrStates(cwd: string, gitHost: GitHostFor = projectGitHost): Promise<PrStates> {
  await cachedRead(prStatesCacheKey(cwd), () =>
    prStates(cwd, gitHost).then(
      () => true,
      () => false,
    ),
  )
  return {
    get: url => {
      const known = newest.get(url)?.request
      return known && { state: listedStateOf(known), title: known.title }
    },
  }
}

/**
 * The cached form of {@link prsForBranch}, shared through the same read-through cache (#1028), each
 * request as the newest read of it says. A read GitHub did not answer is no answer: it is never
 * kept as "no requests", and the ask that waited for it is answered nothing.
 */
export async function cachedPrsForBranch(cwd: string, branch: string, gitHost: GitHostFor = projectGitHost, options: { wait?: true } = {}): Promise<Cached<LinkedPr[]>> {
  const read = await cachedRead(branchPrsCacheKey(cwd, branch), () => prsForBranchOrThrow(cwd, branch, gitHost), options)
  return read.value ? { ...read, value: withHeld(cwd, branch, read.value.map(newestOf)) } : read
}

/** How long a request this machine just acted on is known as it left it, over GitHub's lists: they lag a few seconds behind an open or a close. */
export const HELD_MS = 30_000

/** The requests this machine just opened, closed or merged, by checkout and branch, until when each is held. */
const held = new Map<string, { pr: LinkedPr; until: number }>()

/**
 * A request this machine just opened, closed or merged: the branch's requests say it so for
 * {@link HELD_MS}, whatever GitHub lists meanwhile, which may not have the new one yet, or may
 * still say open the one just closed.
 */
export function holdRequest(cwd: string, branch: string, pr: LinkedPr, now: number = Date.now()): void {
  held.set(branchPrsCacheKey(cwd, branch), { pr, until: now + HELD_MS })
}

/** The branch's requests with the one this machine holds, in its place, or first. */
function withHeld(cwd: string, branch: string, listed: LinkedPr[], now: number = Date.now()): LinkedPr[] {
  const key = branchPrsCacheKey(cwd, branch)
  const hold = held.get(key)
  if (!hold) return listed
  if (now >= hold.until) {
    held.delete(key)
    return listed
  }
  return [hold.pr, ...listed.filter(pr => pr.url !== hold.pr.url)]
}

/**
 * The commit request `number` of `branch` merged as, and the branch's last commit it merged, as the
 * cache last read the branch's requests: still being asked while a first read is out.
 */
export async function mergeLookup(cwd: string, branch: string, number: number, gitHost: GitHostFor = projectGitHost): Promise<MergeLookup> {
  const read = await cachedPrsForBranch(cwd, branch, gitHost).catch((): Cached<LinkedPr[]> => ({ value: undefined, pending: false }))
  if (read.pending && read.value === undefined) return { pending: true }
  const pr = read.value?.find(one => one.number === number)
  return pr?.mergeCommit ? { pending: false, commit: pr.mergeCommit, ...(pr.headRefOid ? { head: pr.headRefOid } : {}) } : { pending: false }
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

function openPrsCacheKey(cwd: string): string {
  return ['open-prs', cwd].join(KEY_SEP)
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
  const listed = await readRequests(source, { state: 'open' })
  if (!listed.ok) throw new Error(listed.error)
  return listed.requests.map(openPrOf)
}

/** How old a project's list of open requests may be before it is read again, behind whoever asks. */
const OPEN_PRS_TTL_MS = 20_000

/** How long a first ask of a project's open requests waits for them: the git host answers well within it. */
const OPEN_PRS_FIRST_MS = 15_000

/**
 * The cached form of {@link openPrs} (#1028), for the Human Queue: it asked the git host at every
 * poll of every page that shows it, and the page waited. The first ask waits for the answer; after
 * that the list last read answers at once and is read again behind it once it is
 * {@link OPEN_PRS_TTL_MS} old. A request opened or merged here is read again at once
 * ({@link forgetPr}). A first read that fails rejects, as {@link openPrs} does; a later one keeps
 * the list last read. A request a newer read found merged, closed or out of draft is as that read says.
 */
export async function cachedOpenPrs(cwd: string, read: (cwd: string) => Promise<OpenPr[]> = openPrs): Promise<OpenPr[]> {
  const cached = await cachedRead(openPrsCacheKey(cwd), () => read(cwd), { ttlMs: OPEN_PRS_TTL_MS, budgetMs: OPEN_PRS_FIRST_MS })
  if (cached.value === undefined) throw new Error('the open pull requests could not be read')
  return cached.value.flatMap(pr => {
    const known = newest.get(pr.url)?.request
    if (!known) return [pr]
    return known.state === 'open' ? [{ ...pr, isDraft: known.draft }] : []
  })
}

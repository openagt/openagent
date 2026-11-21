import { nodeGhRunner, type GhRunner } from './gh.js'

/**
 * The project's pull requests, as one read (#1820): the ones of a branch, the open ones, the ones
 * merged since a time. One shape for every caller, OpenAgent's reads and the scheduler's
 * record alike, so nothing outside this package knows how GitHub spells a state.
 */

/** One pull request, as the command prints it. */
export interface Request {
  number: number
  url: string
  state: 'open' | 'merged' | 'closed'
  title: string
  draft: boolean
  /** The head branch's name. */
  branch: string
  /** The head commit's sha. */
  head: string
  createdAt: string
  mergedAt?: string
  /** The commit a merged request landed as on the base branch. */
  mergeCommit?: string
  /** GitHub will merge it by itself once its checks pass: auto-merge is on for it. */
  armed?: true
}

export interface RequestsQuery {
  /** Only the requests whose head is this branch. */
  branch?: string
  /** Default `all`. */
  state?: 'open' | 'merged' | 'all'
  /** Keep the requests created at or after this time; merged at or after it with `state: 'merged'`. */
  since?: string
}

/** The most requests one read answers. */
export const REQUESTS_LIMIT = 50

const FIELDS = 'number,url,state,title,isDraft,headRefName,headRefOid,createdAt,mergedAt,mergeCommit,autoMergeRequest'

/** The gh command line for a query: what the test checks, and what runs. */
export function requestsArgs(query: RequestsQuery): string[] {
  return ['pr', 'list', '--state', query.state ?? 'all', ...(query.branch ? ['--head', query.branch] : []), '--limit', String(REQUESTS_LIMIT), '--json', FIELDS]
}

interface GhRequest {
  number?: unknown
  url?: unknown
  state?: unknown
  title?: unknown
  isDraft?: unknown
  headRefName?: unknown
  headRefOid?: unknown
  createdAt?: unknown
  mergedAt?: unknown
  mergeCommit?: { oid?: unknown } | null
  autoMergeRequest?: unknown
}

/** gh's OPEN / MERGED / CLOSED, lowercased; anything else reads as closed. */
function stateOf(state: unknown): Request['state'] {
  return state === 'OPEN' ? 'open' : state === 'MERGED' ? 'merged' : 'closed'
}

/** The rows gh printed, as requests; a row without a number and a url is no request. */
export function parseRequests(output: unknown): Request[] {
  if (!Array.isArray(output)) return []
  const requests: Request[] = []
  for (const row of output as GhRequest[]) {
    if (!row || typeof row.number !== 'number' || typeof row.url !== 'string') continue
    requests.push({
      number: row.number,
      url: row.url,
      state: stateOf(row.state),
      title: typeof row.title === 'string' ? row.title : '',
      draft: row.isDraft === true,
      branch: typeof row.headRefName === 'string' ? row.headRefName : '',
      head: typeof row.headRefOid === 'string' ? row.headRefOid : '',
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
      ...(typeof row.mergedAt === 'string' && row.mergedAt ? { mergedAt: row.mergedAt } : {}),
      ...(typeof row.mergeCommit?.oid === 'string' && row.mergeCommit.oid ? { mergeCommit: row.mergeCommit.oid } : {}),
      ...(row.autoMergeRequest && typeof row.autoMergeRequest === 'object' ? { armed: true as const } : {}),
    })
  }
  return requests
}

/** The requests at or after `since`: by merge time when only merged ones were asked for, else by creation time. */
export function sinceFilter(requests: Request[], query: RequestsQuery): Request[] {
  if (!query.since) return requests
  const since = query.since
  return requests.filter(r => (query.state === 'merged' ? (r.mergedAt ?? '') : r.createdAt) >= since)
}

/**
 * The requests matching `query`, newest first as gh lists them. Throws when gh cannot answer
 * (not installed, not logged in, no remote): "none" and "could not tell" must not look alike to a
 * caller about to open a request, or keeping a baseline of what it announced.
 */
export async function listRequests(repo: string, query: RequestsQuery, gh: GhRunner = nodeGhRunner()): Promise<Request[]> {
  return sinceFilter(parseRequests(JSON.parse(await gh(requestsArgs(query), repo)) as unknown), query)
}

/** The open request of a branch, or `undefined`; `undefined` too when gh cannot tell. */
export async function openRequestOf(repo: string, branch: string, gh: GhRunner): Promise<{ number: number; url: string } | undefined> {
  try {
    const [first] = await listRequests(repo, { branch, state: 'open' }, gh)
    return first ? { number: first.number, url: first.url } : undefined
  } catch {
    return undefined
  }
}

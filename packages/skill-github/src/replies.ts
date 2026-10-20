import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { listRuns, type RunCard } from '@openagt/skill-logs'
import { nodeGhRunner, type GhRunner } from './gh.js'
import { COMMENT_MARK } from './comment.js'

/**
 * What came on the pull requests this machine's agents opened, since each agent ended (#2042):
 * the check of a scheduler's row that resumes runs. It prints `[{ "run": "<id>", "text": "…" }]`,
 * one item per run with something new, and the scheduler resumes each run with its words. Each
 * comment and review it hands a run gets 👀 at once, so who wrote sees the agent saw it; the
 * agent's answer comes later, a comment of its own.
 *
 * New is after the run last ended: no time is kept anywhere. Something that comes while the run
 * still works is found at the first look after it ends; and what came before it ended, the run
 * saw or left, so a red check it chose to leave does not wake it again and again.
 *
 * What counts:
 * - a comment or a review of a maintainer, a person who can write to the repository: GitHub's
 *   owner, member or collaborator. One that carries the 🤖 line, or the hidden mark of a comment
 *   `comment` wrote, is an agent's, posted with a person's account, and never counts;
 * - a check that turned red;
 * - a conflict with the base branch, once the base branch moved.
 *
 * Only the open pull requests whose last run was on this machine and has ended: only this machine
 * holds that run's conversation, and a pull request another run still works on is that run's.
 * A pull request is a run's when its branch is the run's branch, as the run's record keeps it:
 * whoever opened the request, the run's agent with any tool or a person, and whether the run
 * could tell its pull request or not. One GitHub call a look, whatever the number of pull requests.
 *
 * A look can be every few seconds (a row's `check-every`), so it first asks GitHub whether any
 * comment of the repository changed, a conversation's or a line's, by the answer it last had
 * (its ETag): "not modified" is free, and then nothing is read. Reviews with no line comments, red
 * checks and conflicts have no such question, so the whole read is made at least once a minute
 * anyway. What the questions last answered and when the last whole read was are a cache in the
 * clone's own `.git` folder, never what decides what is new.
 */

/** A branch runs worked on, with the run that last did and when that run ended. */
export interface Watched {
  branch: string
  run: string
  endedAt: string
}

/** How long a whole read holds when no comment changed: reviews, checks and conflicts are seen at least this often. */
export const WHOLE_READ_EVERY_MS = 60_000

/** The two cheap questions: did a conversation's comment change, did a comment on a line. */
const CHANGED = {
  comments: 'repos/{owner}/{repo}/issues/comments?sort=updated&direction=desc&per_page=1',
  lineComments: 'repos/{owner}/{repo}/pulls/comments?sort=updated&direction=desc&per_page=1',
} as const

/** What the cheap questions last answered, by their ETags, and when the last whole read was. */
interface Looked {
  etags: Partial<Record<keyof typeof CHANGED, string>>
  wholeAt?: number
}

/** The open pull requests one GitHub call reads, newest change first. */
export const REPLIES_LIMIT = 50

/** The authors whose words count: those who can write to the repository. */
const MAINTAINERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/** What an agent puts on what it posts. */
const AGENT_MARK = '🤖'

/** A check's ending that is red. */
const RED = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED', 'ERROR', 'CANCELLED'])

/**
 * Each branch the runs worked on, with the run that last did, when that run is this machine's
 * and has ended. A branch a run still works on, on any machine, is left to it.
 */
export function watchedRequests(cards: RunCard[], host: string): Watched[] {
  const byBranch = new Map<string, RunCard[]>()
  for (const card of cards) if (card.branch) byBranch.set(card.branch, [...(byBranch.get(card.branch) ?? []), card])
  const watched: Watched[] = []
  for (const [branch, runs] of byBranch) {
    if (runs.some(card => card.status === 'running')) continue
    const last = runs.filter(card => card.endedAt !== undefined).sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))[0]
    if (last && last.caller?.['host'] === host) watched.push({ branch, run: last.id, endedAt: last.endedAt! })
  }
  return watched.sort((a, b) => a.branch.localeCompare(b.branch))
}

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: ${REPLIES_LIMIT}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number url mergeable headRefName isCrossRepository
        baseRef { name target { ... on Commit { committedDate } } }
        comments(last: 30) { nodes { id author { login } authorAssociation body createdAt url } }
        reviews(last: 30) {
          nodes {
            id author { login } authorAssociation body state submittedAt url
            comments(first: 30) { nodes { id author { login } authorAssociation body path line createdAt url } }
          }
        }
        commits(last: 1) {
          nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
            __typename
            ... on CheckRun { name conclusion completedAt detailsUrl }
            ... on StatusContext { context state createdAt targetUrl }
          } } } } }
        }
      }
    }
  }
}`

/** The gh command line of the one read: the repository is the one the working directory is in. */
export function repliesArgs(): string[] {
  return ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-f', `query=${QUERY}`]
}

/** One thing that came on a pull request, as the run is told it, and the comment or review it is when a person's, by GitHub's id, for its 👀. */
interface Came {
  at: string
  line: string
  seen?: string
}

/** An open pull request as read: its branch, and what came on it, each with when. */
export interface OpenRequest {
  number: number
  url: string
  branch: string
  came: Came[]
}

type Node = Record<string, unknown>

const nodes = (value: unknown): Node[] => {
  const list = (value as { nodes?: unknown } | null | undefined)?.nodes
  return Array.isArray(list) ? list.filter((n): n is Node => typeof n === 'object' && n !== null) : []
}
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const login = (node: Node): string => text((node['author'] as Node | null | undefined)?.['login']) ?? 'someone'

/** A comment's or a review's id, for its 👀. */
const seen = (node: Node): { seen?: string } => (text(node['id']) !== undefined ? { seen: text(node['id'])! } : {})

/** A maintainer's words that are no agent's: what counts of a comment or a review. */
function maintainers(node: Node): string | undefined {
  const body = text(node['body'])?.trim()
  if (!body || body.includes(AGENT_MARK) || body.includes(COMMENT_MARK) || !MAINTAINERS.has(String(node['authorAssociation']))) return undefined
  return body
}

/**
 * The pull requests GitHub answered, each with what came on it; one it answered in a shape not
 * known is left out, and one from a fork too: a run's branch is on the project's repository, and
 * a fork's branch of the same name is someone else's.
 */
export function parseOpenRequests(output: unknown): OpenRequest[] {
  const repository = ((output as Node | null)?.['data'] as Node | null | undefined)?.['repository'] as Node | null | undefined
  const requests: OpenRequest[] = []
  for (const pr of nodes(repository?.['pullRequests'])) {
    if (typeof pr['number'] !== 'number' || typeof pr['url'] !== 'string' || typeof pr['headRefName'] !== 'string' || pr['isCrossRepository'] !== false) continue
    const came: Came[] = []
    for (const comment of nodes(pr['comments'])) {
      const body = maintainers(comment)
      const at = text(comment['createdAt'])
      if (body && at) came.push({ at, line: `@${login(comment)} commented (${comment['url']}):\n${body}`, ...seen(comment) })
    }
    for (const review of nodes(pr['reviews'])) {
      const at = text(review['submittedAt'])
      const body = maintainers(review)
      // A request for changes counts with no words too; an approval with none asks nothing, and a review's comments count one by one.
      const changes = review['state'] === 'CHANGES_REQUESTED' && MAINTAINERS.has(String(review['authorAssociation'])) && !text(review['body'])?.includes(AGENT_MARK)
      if (at && (body || changes)) came.push({ at, line: `@${login(review)} ${changes ? 'requested changes' : 'reviewed'} (${review['url']})${body ? `:\n${body}` : '.'}`, ...seen(review) })
      for (const comment of nodes(review['comments'])) {
        const words = maintainers(comment)
        const when = text(comment['createdAt'])
        const where = `${comment['path']}${typeof comment['line'] === 'number' ? ` line ${comment['line']}` : ''}`
        if (words && when) came.push({ at: when, line: `@${login(comment)} on ${where} (${comment['url']}):\n${words}`, ...seen(comment) })
      }
    }
    const commit = (nodes(pr['commits'])[0]?.['commit'] as Node | undefined)?.['statusCheckRollup'] as Node | null | undefined
    for (const check of nodes(commit?.['contexts'])) {
      const run = check['__typename'] === 'CheckRun'
      const ending = String(run ? check['conclusion'] : check['state'])
      const at = text(run ? check['completedAt'] : check['createdAt'])
      if (at && RED.has(ending)) came.push({ at, line: `The check "${run ? check['name'] : check['context']}" failed (${(run ? check['detailsUrl'] : check['targetUrl']) ?? 'no link'}).` })
    }
    const base = pr['baseRef'] as Node | null | undefined
    const moved = text((base?.['target'] as Node | null | undefined)?.['committedDate'])
    if (pr['mergeable'] === 'CONFLICTING' && moved) came.push({ at: moved, line: `It conflicts with ${base?.['name']}, which moved since.` })
    requests.push({ number: pr['number'], url: pr['url'], branch: pr['headRefName'], came })
  }
  return requests
}

/** What a run is told, and the comments and reviews among it, by GitHub's ids: a red check or a conflict is none. */
export interface Reply {
  run: string
  text: string
  seen: string[]
}

/** For each open pull request of a watched branch with something new since its run ended, the run, the words it is told, and the comments and reviews among them. */
export function repliesFor(watched: Watched[], open: OpenRequest[]): Reply[] {
  const replies: Reply[] = []
  for (const { branch, run, endedAt } of watched) {
    const request = open.find(r => r.branch === branch)
    // ISO times compare as text only in one shape: GitHub's have no fraction, a record's do.
    const after = Date.parse(endedAt)
    const came = request?.came.filter(c => Date.parse(c.at) > after).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) ?? []
    if (request && came.length > 0) replies.push({ run, text: [`On your pull request #${request.number} (${request.url}), since you ended:`, ...came.map(c => `- ${c.line}`)].join('\n'), seen: came.flatMap(c => (c.seen !== undefined ? [c.seen] : [])) })
  }
  return replies
}

/**
 * Whether what `path` answers changed since the answer whose ETag is `etag`, and the ETag now. gh
 * says "not modified" as a failure, `HTTP 304`; any other failure throws.
 */
async function changedSince(gh: GhRunner, repo: string, path: string, etag: string | undefined): Promise<{ changed: boolean; etag?: string }> {
  try {
    const answered = await gh(['api', '--include', ...(etag !== undefined ? ['-H', `If-None-Match: ${etag}`] : []), path], repo)
    const now = /^etag:\s*(.+?)\s*$/im.exec(answered)?.[1]
    return { changed: true, ...(now !== undefined ? { etag: now } : {}) }
  } catch (err) {
    if (/\bHTTP 304\b/.test(err instanceof Error ? err.message : String(err))) return { changed: false, ...(etag !== undefined ? { etag } : {}) }
    throw err
  }
}

/** Where the cache is: the clone's own `.git` folder; none for a checkout whose `.git` is no folder. */
async function lookedPath(repo: string): Promise<string | undefined> {
  const git = join(repo, '.git')
  return (await stat(git).then(s => s.isDirectory(), () => false)) ? join(git, 'openagent', 'replies.json') : undefined
}

async function readLooked(path: string | undefined): Promise<Looked> {
  if (path === undefined) return { etags: {} }
  const read = await readFile(path, 'utf8').then(text => JSON.parse(text) as Partial<Looked>, () => ({}) as Partial<Looked>)
  return { etags: typeof read.etags === 'object' && read.etags !== null ? read.etags : {}, ...(typeof read.wholeAt === 'number' ? { wholeAt: read.wholeAt } : {}) }
}

async function writeLooked(path: string | undefined, looked: Looked): Promise<void> {
  if (path === undefined) return
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(looked))
}

/** The gh command line of 👀 on each comment and review of `ids`, by GitHub's ids, in one call. */
export function seenArgs(ids: string[]): string[] {
  const reactions = ids.map((id, i) => `r${i}: addReaction(input: { subjectId: ${JSON.stringify(id)}, content: EYES }) { clientMutationId }`)
  return ['api', 'graphql', '-f', `query=mutation { ${reactions.join(' ')} }`]
}

/**
 * What came on this machine's agents' open pull requests since each ended, as a scheduler's row
 * reads it, each comment and review among it given 👀. Throws when GitHub cannot answer.
 */
export async function listReplies(repo: string, deps: { gh?: GhRunner; host?: string; runs?: () => Promise<RunCard[]>; now?: () => number; cache?: string } = {}): Promise<{ run: string; text: string }[]> {
  const watched = watchedRequests(await (deps.runs ?? (() => listRuns(repo)))(), deps.host ?? hostname())
  // Nothing to watch asks GitHub nothing.
  if (watched.length === 0) return []
  const gh = deps.gh ?? nodeGhRunner()
  const now = (deps.now ?? Date.now)()
  const cache = deps.cache ?? (await lookedPath(repo))
  const looked = await readLooked(cache)
  const comments = await changedSince(gh, repo, CHANGED.comments, looked.etags.comments)
  const lineComments = await changedSince(gh, repo, CHANGED.lineComments, looked.etags.lineComments)
  const etags = { ...(comments.etag !== undefined ? { comments: comments.etag } : {}), ...(lineComments.etag !== undefined ? { lineComments: lineComments.etag } : {}) }
  if (!comments.changed && !lineComments.changed && looked.wholeAt !== undefined && now - looked.wholeAt < WHOLE_READ_EVERY_MS) return []
  const answered = await gh(repliesArgs(), repo)
  const replies = repliesFor(watched, parseOpenRequests(JSON.parse(answered) as unknown))
  // GitHub keeps one 👀 a person: one put again, at a look that finds the same comment while its
  // run cannot start yet, is no second. One that could not be put leaves the answer to come.
  const ids = replies.flatMap(r => r.seen)
  if (ids.length > 0) await gh(seenArgs(ids), repo).catch(() => undefined)
  await writeLooked(cache, { etags, wholeAt: now })
  return replies.map(({ run, text }) => ({ run, text }))
}

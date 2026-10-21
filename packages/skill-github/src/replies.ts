import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { listRuns, type RunCard } from '@openagt/skill-logs'
import type { GitRunner } from '@openagt/agent-data'
import { nodeGhRunner, type GhRunner } from './gh.js'
import { COMMENT_MARK } from './comment.js'
import { pushFork } from './home.js'

/**
 * What came on the project's open issues and pull requests for this machine's agents (#2042): the
 * check of a scheduler's row with `each`. It prints one item per run: `{ "run": "<id>", "text":
 * "…" }` for a run to continue with its words, `{ "for": "<address>", "text": "…" }` for a thread
 * no run is on, where someone called the agent, and the scheduler starts a run for it, its record
 * naming the thread, so the next call there finds that run. Each comment and review it hands a run
 * gets 👀 at once, so who wrote sees the agent saw it; the agent's answer comes later, a comment of
 * its own.
 *
 * A thread's run is the run that last worked on it: one started for it, or, on a pull request, one
 * whose branch is the request's, as the run's record keeps it, whoever opened the request, the
 * run's agent with any tool or a person, and whether the run could tell its pull request or not.
 * The request's branch is on the project's repository, or on the fork this machine pushes to (an
 * account that cannot write to the project pushes there); another fork's is someone else's.
 * Only a thread whose run is this machine's and has ended: only this machine holds that run's
 * conversation, and a thread another run still works on is that run's.
 *
 * New, for a run, is after it last ended: no time is kept anywhere. Something that comes while the
 * run still works is found at the first look after it ends; and what came before it ended, the run
 * saw or left, so a red check it chose to leave does not wake it again and again. For a thread no
 * run is on, new is after the row was switched on on this machine (`--since`): a call made before
 * starts nothing. Without `--since`, no run is started.
 *
 * What counts:
 * - an issue's or a pull request's text, a comment, a review or a line comment of a maintainer, a
 *   person who can write to the repository: GitHub's owner, member or collaborator, that calls the
 *   agent: `/agent`, a word of its own anywhere in it, when written or last edited. Other words
 *   are people talking, on the agent's own pull request too. One that carries the 🤖 line, or the
 *   hidden mark of a comment `comment` wrote, is an agent's, posted with a person's account, and
 *   never counts;
 * - on the agent's own pull request only, one whose branch its run made: a check that turned red,
 *   with no word, nobody writes one; a conflict with the base branch, once the base branch moved.
 *   A person's pull request an agent was called on is the person's: only a call counts there.
 *
 * One GitHub call a look, whatever the number of threads. A look can be every few seconds (a row's
 * `check-every`), so it first asks GitHub whether any issue or comment of the repository changed,
 * by the answer it last had (its ETag): "not modified" is free, and then nothing is read. Reviews
 * with no line comments, red checks and conflicts have no such question, so the whole read is made
 * at least once a minute anyway. What the questions last answered and when the last whole read was
 * are a cache in the clone's own `.git` folder, never what decides what is new.
 */

/** How long a whole read holds when nothing changed: reviews, checks and conflicts are seen at least this often. */
export const WHOLE_READ_EVERY_MS = 60_000

/** The cheap questions: did an issue or a pull request change, a conversation's comment, a comment on a line. */
const CHANGED = {
  threads: 'repos/{owner}/{repo}/issues?state=all&sort=updated&direction=desc&per_page=1',
  comments: 'repos/{owner}/{repo}/issues/comments?sort=updated&direction=desc&per_page=1',
  lineComments: 'repos/{owner}/{repo}/pulls/comments?sort=updated&direction=desc&per_page=1',
} as const

/** What the cheap questions last answered, by their ETags, and when the last whole read was. */
interface Looked {
  etags: Partial<Record<keyof typeof CHANGED, string>>
  wholeAt?: number
}

/** The open issues, and the open pull requests, one GitHub call reads, newest change first. */
export const REPLIES_LIMIT = 50

/** The authors whose words count: those who can write to the repository. */
const MAINTAINERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/** What an agent puts on what it posts. */
const AGENT_MARK = '🤖'

/** The word that calls the agent: `/agent` with nothing of a word or a path on either side. */
export const MENTION = /(?<![\w/])\/agent(?![\w/-])/

/** A check's ending that is red. */
const RED = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED', 'ERROR', 'CANCELLED'])

/** The words of a thread, a comment or a review, as the query reads them. */
const WORDS = 'id author { login } authorAssociation body createdAt lastEditedAt url'

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: ${REPLIES_LIMIT}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number title ${WORDS} comments(last: 30) { nodes { ${WORDS} } } }
    }
    pullRequests(states: OPEN, first: ${REPLIES_LIMIT}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number title ${WORDS} mergeable headRefName isCrossRepository headRepository { nameWithOwner }
        baseRef { name target { ... on Commit { committedDate } } }
        comments(last: 30) { nodes { ${WORDS} } }
        reviews(last: 30) {
          nodes {
            id author { login } authorAssociation body state submittedAt lastEditedAt url
            comments(first: 30) { nodes { ${WORDS} path line } }
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

/** One thing that came on a thread, as a run is told it, and the words it is when a person's, by GitHub's id, for their 👀. */
interface Came {
  at: string
  line: string
  seen?: string
}

/** An open issue or pull request as read: where it is, its pull request's branch, and what came on it, each with when. */
export interface Thread {
  kind: 'issue' | 'pull request'
  number: number
  url: string
  title: string
  /** A pull request's branch on the project's repository or on the fork this machine pushes to; none for an issue, and none for another fork's: its branch of a run's branch name is someone else's. */
  branch?: string
  /** Whether the pull request comes from another fork. */
  fork?: true
  /** The maintainers' words that call the agent. */
  calls: Came[]
  /** A pull request's red checks and its conflict: what wakes the agent on its own pull request with no word. */
  broken: Came[]
}

type Node = Record<string, unknown>

const nodes = (value: unknown): Node[] => {
  const list = (value as { nodes?: unknown } | null | undefined)?.nodes
  return Array.isArray(list) ? list.filter((n): n is Node => typeof n === 'object' && n !== null) : []
}
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const login = (node: Node): string => text((node['author'] as Node | null | undefined)?.['login']) ?? 'someone'

/** When words were written, or last edited when that is later: an edit that adds a call is a call. */
const writtenAt = (node: Node, written: string): string | undefined => {
  const at = text(node[written])
  const edited = text(node['lastEditedAt'])
  return at === undefined ? undefined : edited !== undefined && Date.parse(edited) > Date.parse(at) ? edited : at
}

/** A comment's or a review's id, for its 👀. */
const seen = (node: Node): { seen?: string } => (text(node['id']) !== undefined ? { seen: text(node['id'])! } : {})

/** A maintainer's words that call the agent and are no agent's: what counts of a thread's text, a comment or a review. */
function maintainers(node: Node): string | undefined {
  const body = text(node['body'])?.trim()
  if (!body || !MENTION.test(body) || body.includes(AGENT_MARK) || body.includes(COMMENT_MARK) || !MAINTAINERS.has(String(node['authorAssociation']))) return undefined
  return body
}

/** The calls in a thread's own text and in its conversation's comments. */
function threadCalls(thread: Node): Came[] {
  const came: Came[] = []
  const body = maintainers(thread)
  const opened = writtenAt(thread, 'createdAt')
  if (body && opened) came.push({ at: opened, line: `@${login(thread)} opened it (${thread['url']}):\n${body}`, ...seen(thread) })
  for (const comment of nodes(thread['comments'])) {
    const words = maintainers(comment)
    const at = writtenAt(comment, 'createdAt')
    if (words && at) came.push({ at, line: `@${login(comment)} commented (${comment['url']}):\n${words}`, ...seen(comment) })
  }
  return came
}

/** The open issues and pull requests GitHub answered, each with what came on it; one it answered in a shape not known is left out. `fork` is the repository this machine pushes to, when not the project's own. */
export function parseThreads(output: unknown, fork?: string): Thread[] {
  const repository = ((output as Node | null)?.['data'] as Node | null | undefined)?.['repository'] as Node | null | undefined
  const threads: Thread[] = []
  const known = (node: Node): node is Node & { number: number; url: string } => typeof node['number'] === 'number' && typeof node['url'] === 'string'
  for (const issue of nodes(repository?.['issues'])) {
    if (known(issue)) threads.push({ kind: 'issue', number: issue.number, url: issue.url, title: text(issue['title']) ?? '', calls: threadCalls(issue), broken: [] })
  }
  for (const pr of nodes(repository?.['pullRequests'])) {
    if (!known(pr) || typeof pr['headRefName'] !== 'string' || typeof pr['isCrossRepository'] !== 'boolean') continue
    const calls = threadCalls(pr)
    for (const review of nodes(pr['reviews'])) {
      const at = writtenAt(review, 'submittedAt')
      const body = maintainers(review)
      // A review's comments count one by one, each by its own word.
      if (at && body) calls.push({ at, line: `@${login(review)} ${review['state'] === 'CHANGES_REQUESTED' ? 'requested changes' : 'reviewed'} (${review['url']}):\n${body}`, ...seen(review) })
      for (const comment of nodes(review['comments'])) {
        const words = maintainers(comment)
        const when = writtenAt(comment, 'createdAt')
        const where = `${comment['path']}${typeof comment['line'] === 'number' ? ` line ${comment['line']}` : ''}`
        if (words && when) calls.push({ at: when, line: `@${login(comment)} on ${where} (${comment['url']}):\n${words}`, ...seen(comment) })
      }
    }
    const broken: Came[] = []
    const commit = (nodes(pr['commits'])[0]?.['commit'] as Node | undefined)?.['statusCheckRollup'] as Node | null | undefined
    for (const check of nodes(commit?.['contexts'])) {
      const run = check['__typename'] === 'CheckRun'
      const ending = String(run ? check['conclusion'] : check['state'])
      const at = text(run ? check['completedAt'] : check['createdAt'])
      if (at && RED.has(ending)) broken.push({ at, line: `The check "${run ? check['name'] : check['context']}" failed (${(run ? check['detailsUrl'] : check['targetUrl']) ?? 'no link'}).` })
    }
    const base = pr['baseRef'] as Node | null | undefined
    const moved = text((base?.['target'] as Node | null | undefined)?.['committedDate'])
    if (pr['mergeable'] === 'CONFLICTING' && moved) broken.push({ at: moved, line: `It conflicts with ${base?.['name']}, which moved since.` })
    const head = text((pr['headRepository'] as Node | null | undefined)?.['nameWithOwner'])
    const another = pr['isCrossRepository'] === true && (fork === undefined || head?.toLowerCase() !== fork.toLowerCase())
    threads.push({ kind: 'pull request', number: pr.number, url: pr.url, title: text(pr['title']) ?? '', ...(another ? { fork: true as const } : { branch: pr['headRefName'] }), calls, broken })
  }
  return threads
}

/** What the scheduler is told for a thread: the run to continue, or what a new run is for and the branch it works on, with the words. */
export type Told = { run: string; text: string } | { for: string; branch?: string; text: string }

/** The same, and the words among it, by GitHub's ids, for their 👀: a red check or a conflict is none. */
export type Answer = Told & { seen: string[] }

/** A run as a thread's: its branch, what it was started for, whether it still works, when it ended, its machine. */
interface Ran {
  id: string
  branch?: string
  for?: string
  running: boolean
  endedAt?: string
  host?: string
}

function ran(card: RunCard): Ran {
  const started = card.caller?.['for']
  const host = card.caller?.['host']
  return { id: card.id, ...(card.branch !== undefined ? { branch: card.branch } : {}), ...(typeof started === 'string' ? { for: started } : {}), running: card.status === 'running', ...(card.endedAt !== undefined ? { endedAt: card.endedAt } : {}), ...(typeof host === 'string' ? { host } : {}) }
}

/** Oldest first, and only what came after `since`. ISO times compare as text only in one shape: GitHub's have no fraction, a record's do. */
const cameAfter = (came: Came[], since: string): Came[] => came.filter(c => Date.parse(c.at) > Date.parse(since)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

const told = (head: string, came: Came[]): { text: string; seen: string[] } => ({ text: [head, ...came.map(c => `- ${c.line}`)].join('\n'), seen: came.flatMap(c => (c.seen !== undefined ? [c.seen] : [])) })

/**
 * For each thread with something new: its run, when that run is this machine's and has ended, and
 * the words it is told; or, for a thread no run was ever on, what a new run is for, with the calls
 * made there since `since`. A thread a run still works on, on any machine, is left to it.
 */
export function answersFor(threads: Thread[], cards: RunCard[], host: string, since?: string): Answer[] {
  const runs = cards.map(ran)
  const answers: Answer[] = []
  for (const thread of threads) {
    const its = runs.filter(r => r.for === thread.url || (thread.branch !== undefined && r.branch === thread.branch))
    if (its.some(r => r.running)) continue
    const last = its.filter(r => r.endedAt !== undefined).sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))[0]
    const name = `${thread.kind} #${thread.number} (${thread.url})`
    if (last === undefined) {
      const came = since !== undefined ? cameAfter(thread.calls, since) : []
      const on = thread.branch !== undefined ? `, on its branch ${thread.branch}` : thread.fork ? ', from a fork: you are not on its branch, and cannot push to it' : ''
      if (came.length > 0) answers.push({ for: thread.url, ...(thread.branch !== undefined ? { branch: thread.branch } : {}), ...told(`You are called on ${name}, "${thread.title}"${on}:`, came) })
      continue
    }
    if (last.host !== host) continue
    // The agent's own pull request: its run made the branch, and no run was started for the request.
    const own = thread.kind === 'pull request' && !its.some(r => r.for === thread.url)
    const came = cameAfter([...thread.calls, ...(own ? thread.broken : [])], last.endedAt!)
    if (came.length > 0) answers.push({ run: last.id, ...told(`On ${own ? `your ${name}` : name}, since you ended:`, came) })
  }
  return answers
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

/** The gh command line of 👀 on each thread, comment and review of `ids`, by GitHub's ids, in one call. */
export function seenArgs(ids: string[]): string[] {
  const reactions = ids.map((id, i) => `r${i}: addReaction(input: { subjectId: ${JSON.stringify(id)}, content: EYES }) { clientMutationId }`)
  return ['api', 'graphql', '-f', `query=mutation { ${reactions.join(' ')} }`]
}

/**
 * What came on the project's open issues and pull requests for this machine's agents, as a
 * scheduler's row reads it, each call among it given 👀; with `since`, the threads no run is on
 * where someone called the agent since then too. Throws when GitHub cannot answer.
 */
export async function listReplies(repo: string, deps: { gh?: GhRunner; git?: GitRunner; host?: string; runs?: () => Promise<RunCard[]>; now?: () => number; cache?: string; since?: string } = {}): Promise<Told[]> {
  const cards = await (deps.runs ?? (() => listRuns(repo)))()
  const host = deps.host ?? hostname()
  // Nothing to resume and no thread to start for asks GitHub nothing.
  if (deps.since === undefined && !cards.some(card => card.caller?.['host'] === host && card.endedAt !== undefined)) return []
  const gh = deps.gh ?? nodeGhRunner()
  const now = (deps.now ?? Date.now)()
  const cache = deps.cache ?? (await lookedPath(repo))
  const looked = await readLooked(cache)
  const etags: Looked['etags'] = {}
  let changed = false
  for (const what of Object.keys(CHANGED) as (keyof typeof CHANGED)[]) {
    const asked = await changedSince(gh, repo, CHANGED[what], looked.etags[what])
    if (asked.etag !== undefined) etags[what] = asked.etag
    changed ||= asked.changed
  }
  if (!changed && looked.wholeAt !== undefined && now - looked.wholeAt < WHOLE_READ_EVERY_MS) return []
  const answered = await gh(repliesArgs(), repo)
  const answers = answersFor(parseThreads(JSON.parse(answered) as unknown, await pushFork(repo, deps.git)), cards, host, deps.since)
  // GitHub keeps one 👀 a person: one put again, at a look that finds the same comment while its
  // run cannot start yet, is no second. One that could not be put leaves the answer to come.
  const ids = answers.flatMap(a => a.seen)
  if (ids.length > 0) await gh(seenArgs(ids), repo).catch(() => undefined)
  await writeLooked(cache, { etags, wholeAt: now })
  return answers.map(({ seen: _seen, ...answer }) => answer)
}

import { hostname } from 'node:os'
import { listRuns, type RunCard } from '@openagt/skill-logs'
import { nodeGhRunner, type GhRunner } from './gh.js'

/**
 * What came on the pull requests this machine's agents opened, since each agent ended (#2042):
 * the check of a scheduler's row that resumes runs. It prints `[{ "run": "<id>", "text": "…" }]`,
 * one item per run with something new, and the scheduler resumes each run with its words.
 *
 * New is after the run last ended: no time is kept anywhere. Something that comes while the run
 * still works is found at the first look after it ends; and what came before it ended, the run
 * saw or left, so a red check it chose to leave does not wake it again and again.
 *
 * What counts:
 * - a comment or a review of a maintainer, a person who can write to the repository: GitHub's
 *   owner, member or collaborator. One that carries the 🤖 line is an agent's, posted with a
 *   person's account, and never counts;
 * - a check that turned red;
 * - a conflict with the base branch, once the base branch moved.
 *
 * Only the open pull requests whose last run was on this machine and has ended: only this machine
 * holds that run's conversation, and a pull request another run still works on is that run's.
 * One GitHub call a look, whatever the number of pull requests.
 */

/** A pull request a run opened, with the run that last worked on it and when that run ended. */
export interface Watched {
  number: number
  run: string
  endedAt: string
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
 * Each pull request the runs worked on, with the run that last did, when that run is this
 * machine's and has ended. A pull request a run still works on, on any machine, is left to it.
 */
export function watchedRequests(cards: RunCard[], host: string): Watched[] {
  const byRequest = new Map<number, RunCard[]>()
  for (const card of cards) if (card.pr) byRequest.set(card.pr.number, [...(byRequest.get(card.pr.number) ?? []), card])
  const watched: Watched[] = []
  for (const [number, runs] of byRequest) {
    if (runs.some(card => card.status === 'running')) continue
    const last = runs.filter(card => card.endedAt !== undefined).sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))[0]
    if (last && last.caller?.['host'] === host) watched.push({ number, run: last.id, endedAt: last.endedAt! })
  }
  return watched.sort((a, b) => a.number - b.number)
}

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: ${REPLIES_LIMIT}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number url mergeable
        baseRef { name target { ... on Commit { committedDate } } }
        comments(last: 30) { nodes { author { login } authorAssociation body createdAt url } }
        reviews(last: 30) {
          nodes {
            author { login } authorAssociation body state submittedAt url
            comments(first: 30) { nodes { author { login } authorAssociation body path line createdAt url } }
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

/** One thing that came on a pull request, as the run is told it. */
interface Came {
  at: string
  line: string
}

/** An open pull request as read: what came on it, each with when. */
export interface OpenRequest {
  number: number
  url: string
  came: Came[]
}

type Node = Record<string, unknown>

const nodes = (value: unknown): Node[] => {
  const list = (value as { nodes?: unknown } | null | undefined)?.nodes
  return Array.isArray(list) ? list.filter((n): n is Node => typeof n === 'object' && n !== null) : []
}
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const login = (node: Node): string => text((node['author'] as Node | null | undefined)?.['login']) ?? 'someone'

/** A maintainer's words that are no agent's: what counts of a comment or a review. */
function maintainers(node: Node): string | undefined {
  const body = text(node['body'])?.trim()
  if (!body || body.includes(AGENT_MARK) || !MAINTAINERS.has(String(node['authorAssociation']))) return undefined
  return body
}

/** The pull requests GitHub answered, each with what came on it; one it answered in a shape not known is left out. */
export function parseOpenRequests(output: unknown): OpenRequest[] {
  const repository = ((output as Node | null)?.['data'] as Node | null | undefined)?.['repository'] as Node | null | undefined
  const requests: OpenRequest[] = []
  for (const pr of nodes(repository?.['pullRequests'])) {
    if (typeof pr['number'] !== 'number' || typeof pr['url'] !== 'string') continue
    const came: Came[] = []
    for (const comment of nodes(pr['comments'])) {
      const body = maintainers(comment)
      const at = text(comment['createdAt'])
      if (body && at) came.push({ at, line: `@${login(comment)} commented (${comment['url']}):\n${body}` })
    }
    for (const review of nodes(pr['reviews'])) {
      const at = text(review['submittedAt'])
      const body = maintainers(review)
      // A request for changes counts with no words too; an approval with none asks nothing, and a review's comments count one by one.
      const changes = review['state'] === 'CHANGES_REQUESTED' && MAINTAINERS.has(String(review['authorAssociation'])) && !text(review['body'])?.includes(AGENT_MARK)
      if (at && (body || changes)) came.push({ at, line: `@${login(review)} ${changes ? 'requested changes' : 'reviewed'} (${review['url']})${body ? `:\n${body}` : '.'}` })
      for (const comment of nodes(review['comments'])) {
        const words = maintainers(comment)
        const when = text(comment['createdAt'])
        const where = `${comment['path']}${typeof comment['line'] === 'number' ? ` line ${comment['line']}` : ''}`
        if (words && when) came.push({ at: when, line: `@${login(comment)} on ${where} (${comment['url']}):\n${words}` })
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
    requests.push({ number: pr['number'], url: pr['url'], came })
  }
  return requests
}

/** For each watched pull request with something new since its run ended, the run and the words it is told. */
export function repliesFor(watched: Watched[], open: OpenRequest[]): { run: string; text: string }[] {
  const replies: { run: string; text: string }[] = []
  for (const { number, run, endedAt } of watched) {
    const request = open.find(r => r.number === number)
    // ISO times compare as text only in one shape: GitHub's have no fraction, a record's do.
    const after = Date.parse(endedAt)
    const came = request?.came.filter(c => Date.parse(c.at) > after).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) ?? []
    if (request && came.length > 0) replies.push({ run, text: [`On your pull request #${number} (${request.url}), since you ended:`, ...came.map(c => `- ${c.line}`)].join('\n') })
  }
  return replies
}

/** What came on this machine's agents' open pull requests since each ended, as a scheduler's row reads it. Throws when GitHub cannot answer. */
export async function listReplies(repo: string, deps: { gh?: GhRunner; host?: string; runs?: () => Promise<RunCard[]> } = {}): Promise<{ run: string; text: string }[]> {
  const watched = watchedRequests(await (deps.runs ?? (() => listRuns(repo)))(), deps.host ?? hostname())
  // Nothing to watch asks GitHub nothing.
  if (watched.length === 0) return []
  const answered = await (deps.gh ?? nodeGhRunner())(repliesArgs(), repo)
  return repliesFor(watched, parseOpenRequests(JSON.parse(answered) as unknown))
}

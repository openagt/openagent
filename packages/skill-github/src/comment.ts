import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { GhRunner } from './gh.js'

/**
 * A comment on an issue's or a pull request's thread: how an agent a row woke answers there (#2042). Asked
 * of GitHub's REST API through `gh`, in the repository the working directory is in.
 *
 * It opens with what wrote it: the coding agent's logo, the model and how hard it thought, as the
 * agent's run record says, found through the log path its runner hands the agent (`AGENT_DIARY`).
 * An agent with no run record behind it is said with the 🤖 line. The logos are this package's
 * `assets`, at the version that wrote the comment, as the npm registry serves them through
 * jsDelivr: a comment keeps its pictures however the package changes later.
 */

/**
 * The line every comment this command writes ends with, hidden from readers: what an agent
 * writes here is posted with a person's account, and `replies` must never count it as theirs.
 */
export const COMMENT_MARK = '<!-- openagent -->'

/** Where the agent's runner put its log: its run record is beside it. */
export const DIARY_ENV = 'AGENT_DIARY'

/** Where this package's pictures are served from: its own version's, on the npm registry. */
export const ASSETS_URL = `https://cdn.jsdelivr.net/npm/@openagt/skill-github@${(createRequire(import.meta.url)('../package.json') as { version: string }).version}/assets`

/** The coding agents' logos, by the id a run record names them by. */
const LOGOS: Record<string, string> = {
  'claude-code': `<img src="${ASSETS_URL}/claude.svg" width="16" height="16" align="top" alt="Claude Code">`,
  codex: `<picture><source media="(prefers-color-scheme: dark)" srcset="${ASSETS_URL}/codex-dark.svg"><img src="${ASSETS_URL}/codex-light.svg" width="16" height="16" align="top" alt="Codex"></picture>`,
}

/** What an agent with no run record, or on a coding agent with no logo, opens with. */
const AUTOMATED = '🤖 *automated*'

/**
 * The first line, from the run record beside the log at `diary`: the logo, the model (a Claude
 * model without its `claude-` prefix) and the effort, each when the record says it.
 */
export async function byline(diary: string | undefined): Promise<string> {
  if (diary === undefined || !diary.endsWith('.jsonl')) return AUTOMATED
  const card = await readFile(`${diary.slice(0, -'.jsonl'.length)}.json`, 'utf8').then(text => JSON.parse(text) as Record<string, unknown>, () => undefined)
  const logo = typeof card?.['driver'] === 'string' ? LOGOS[card['driver']] : undefined
  if (logo === undefined) return AUTOMATED
  const model = typeof card!['model'] === 'string' ? card!['model'].replace(/^claude-/, '') : undefined
  const effort = typeof card!['effort'] === 'string' ? `${card!['effort']} effort` : undefined
  const on = [model, effort].filter(part => part !== undefined).join(' · ')
  return on === '' ? logo : `${logo} ${on}`
}

/** A comment as GitHub answered it: its id and its address. */
export interface Comment {
  id: number
  url: string
}

/** The gh command line of a new comment on issue or pull request `number`: the first line, the text, the mark. */
export function commentArgs(number: number, body: string, first: string): string[] {
  return ['api', `repos/{owner}/{repo}/issues/${number}/comments`, '-f', `body=${first}\n\n${body}\n\n${COMMENT_MARK}`, '--jq', '{id: .id, url: .html_url}']
}

/** Post a comment on issue or pull request `number`, opened with `first`: the comment as GitHub answered. Throws when GitHub cannot answer, or answers no comment. */
export async function writeComment(cwd: string, number: number, body: string, first: string, gh: GhRunner): Promise<Comment> {
  const answer = JSON.parse(await gh(commentArgs(number, body, first), cwd)) as Partial<Comment> | null
  if (typeof answer?.id !== 'number' || typeof answer.url !== 'string') throw new Error('GitHub answered no comment')
  return { id: answer.id, url: answer.url }
}

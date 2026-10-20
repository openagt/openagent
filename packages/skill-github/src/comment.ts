import type { GhRunner } from './gh.js'

/**
 * A comment on a pull request's thread: how an agent a row resumed answers there (#2042). Asked
 * of GitHub's REST API through `gh`, in the repository the working directory is in.
 */

/**
 * The line every comment this command writes ends with, hidden from readers: what an agent
 * writes here is posted with a person's account, and `replies` must never count it as theirs.
 */
export const COMMENT_MARK = '<!-- openagent -->'

/** The text as posted: the mark after it. */
const marked = (body: string): string => `${body}\n\n${COMMENT_MARK}`

/** A comment as GitHub answered it: its id and its address. */
export interface Comment {
  id: number
  url: string
}

/** The gh command line of a new comment with `body` on pull request `number`. */
export function commentArgs(number: number, body: string): string[] {
  return ['api', `repos/{owner}/{repo}/issues/${number}/comments`, '-f', `body=${marked(body)}`, '--jq', '{id: .id, url: .html_url}']
}

/** Post a comment on pull request `number`: the comment as GitHub answered. Throws when GitHub cannot answer, or answers no comment. */
export async function writeComment(cwd: string, number: number, body: string, gh: GhRunner): Promise<Comment> {
  const answer = JSON.parse(await gh(commentArgs(number, body), cwd)) as Partial<Comment> | null
  if (typeof answer?.id !== 'number' || typeof answer.url !== 'string') throw new Error('GitHub answered no comment')
  return { id: answer.id, url: answer.url }
}

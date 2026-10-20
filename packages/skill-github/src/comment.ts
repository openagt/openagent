import type { GhRunner } from './gh.js'

/**
 * A comment on a pull request's thread, and its text replaced later: how a run a row resumed
 * keeps its one comment there while it works, then turns it into its answer (#2042). Asked of
 * GitHub's REST API through `gh`, in the repository the working directory is in.
 */

/**
 * The line every comment this command writes ends with, hidden from readers: what an agent
 * writes here is posted with a person's account, and `replies` must never count it as theirs.
 */
export const COMMENT_MARK = '<!-- openagent -->'

/** The text as posted: the mark after it. */
const marked = (body: string): string => `${body}\n\n${COMMENT_MARK}`

/** A comment as GitHub answered it: its id, for an edit, and its address. */
export interface Comment {
  id: number
  url: string
}

/** The gh command line of a new comment with `body` on pull request `number`. */
export function commentArgs(number: number, body: string): string[] {
  return ['api', `repos/{owner}/{repo}/issues/${number}/comments`, '-f', `body=${marked(body)}`, '--jq', '{id: .id, url: .html_url}']
}

/** The gh command line of comment `id`'s text replaced by `body`. */
export function editCommentArgs(id: number, body: string): string[] {
  return ['api', '-X', 'PATCH', `repos/{owner}/{repo}/issues/comments/${id}`, '-f', `body=${marked(body)}`, '--jq', '{id: .id, url: .html_url}']
}

/** Post a comment, or replace one's text with `edit`: the comment as GitHub answered. Throws when GitHub cannot answer, or answers no comment. */
export async function writeComment(cwd: string, to: { number: number } | { edit: number }, body: string, gh: GhRunner): Promise<Comment> {
  const answer = JSON.parse(await gh('edit' in to ? editCommentArgs(to.edit, body) : commentArgs(to.number, body), cwd)) as Partial<Comment> | null
  if (typeof answer?.id !== 'number' || typeof answer.url !== 'string') throw new Error('GitHub answered no comment')
  return { id: answer.id, url: answer.url }
}

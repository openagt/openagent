import type { GhRunner } from './gh.js'

/**
 * The GitHub accounts behind a project's commit emails: for each email, the account whose commit in
 * the project's repository is signed with it, with its picture. What OpenAgent shows beside a
 * person it knows only by the email their runs and commits carry. One question per email (the
 * newest commit of theirs); an email no commit of the repository's account carries is left out.
 */

/** A person of the project, as GitHub knows them: their email, their login, and their picture. */
export interface GitHubPerson {
  email: string
  login: string
  /** A picture of them: an https address. */
  avatar?: string
}

/** How many emails one ask looks up: one question each. */
export const MAX_PEOPLE = 20

export async function peopleByEmail(cwd: string, emails: readonly string[], gh: GhRunner): Promise<GitHubPerson[]> {
  const found = await Promise.all(
    emails.slice(0, MAX_PEOPLE).map(async (email): Promise<GitHubPerson | undefined> => {
      const said = await gh(['api', `repos/{owner}/{repo}/commits?author=${encodeURIComponent(email)}&per_page=1`, '--jq', '.[0].author // empty | {login: .login, avatar: .avatar_url}'], cwd).catch(() => '')
      if (!said.trim()) return undefined
      const { login, avatar } = JSON.parse(said) as Record<string, unknown>
      if (typeof login !== 'string' || !login) return undefined
      return { email, login, ...(typeof avatar === 'string' && avatar.startsWith('https://') ? { avatar } : {}) }
    }),
  )
  return found.filter((person): person is GitHubPerson => person !== undefined)
}

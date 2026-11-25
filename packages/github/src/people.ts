import type { GhRunner } from './gh.js'

/**
 * The GitHub accounts behind a project's commit emails: for each email, the account whose commit in
 * the project's repository is signed with it, with its picture. What OpenAgent shows beside a
 * person it knows only by the email their runs and commits carry. One question per email (the
 * newest commit of theirs); an email no commit of the repository's account carries is left out.
 * GitHub's own address for an account says the account itself, so it needs no commit and no question.
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

/** GitHub's own address for an account, `<id>+<login>@users.noreply.github.com`: what a server's git signs with when it was given no email. */
const OWN_ADDRESS = /^(\d+)\+([^@]+)@users\.noreply\.github\.com$/i

export async function peopleByEmail(cwd: string, emails: readonly string[], gh: GhRunner): Promise<GitHubPerson[]> {
  const found = await Promise.all(
    emails.slice(0, MAX_PEOPLE).map(async (email): Promise<GitHubPerson | undefined> => {
      const own = OWN_ADDRESS.exec(email)
      if (own) return { email, login: own[2]!, avatar: `https://avatars.githubusercontent.com/u/${own[1]!}` }
      const said = await gh(['api', `repos/{owner}/{repo}/commits?author=${encodeURIComponent(email)}&per_page=1`, '--jq', '.[0].author // empty | {login: .login, avatar: .avatar_url}'], cwd).catch(() => '')
      if (!said.trim()) return undefined
      const { login, avatar } = JSON.parse(said) as Record<string, unknown>
      if (typeof login !== 'string' || !login) return undefined
      return { email, login, ...(typeof avatar === 'string' && avatar.startsWith('https://') ? { avatar } : {}) }
    }),
  )
  return found.filter((person): person is GitHubPerson => person !== undefined)
}

/** How long what GitHub said of an email is kept, an email it knows nobody for too: a person's account and picture seldom change, and each ask is a question to GitHub. */
const KEEP_MS = 24 * 60 * 60_000

/**
 * The people behind a repository's commit emails, `ask`ed of GitHub and kept a day: what a card
 * shows as each person's picture, so a card that asks every minute asks GitHub once a day per
 * person. What it said of an email is kept, a miss too; when it could not be asked, nothing is
 * kept, so it is asked again next time. Each repository is its own.
 */
export function keptPeople(ask: (dir: string, emails: string[]) => Promise<GitHubPerson[]>, now: () => number = Date.now): (dir: string, emails: readonly string[]) => Promise<GitHubPerson[]> {
  const kept = new Map<string, { at: number; person: GitHubPerson | undefined }>()
  return async (dir, emails) => {
    const at = now()
    const key = (email: string): string => `${dir}\n${email.toLowerCase()}`
    const fresh = (email: string): boolean => {
      const known = kept.get(key(email))
      return known !== undefined && at - known.at < KEEP_MS
    }
    const asking = [...new Set(emails.filter(email => typeof email === 'string' && email.includes('@')))].filter(email => !fresh(email))
    for (let from = 0; from < asking.length; from += MAX_PEOPLE) {
      const some = asking.slice(from, from + MAX_PEOPLE)
      const found = await ask(dir, some).catch(() => undefined)
      if (found) for (const email of some) kept.set(key(email), { at, person: found.find(person => person.email.toLowerCase() === email.toLowerCase()) })
    }
    return emails.flatMap(email => kept.get(key(email))?.person ?? [])
  }
}

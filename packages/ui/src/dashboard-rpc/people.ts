import { projectGitHost, type GitHostFor, type GitHostPerson } from '../store/git-host.js'
import { resolveProjectPath } from './context.js'

/** A person of a project, as its git host knows them: their email, login and picture. */
export type HostPerson = GitHostPerson & { email: string }

/** How long what the git host said of an email is kept, an email it knows nobody for too: a person's account and picture seldom change, and each ask is a call to the host. */
const KEEP_MS = 24 * 60 * 60_000

const kept = new Map<string, { at: number; person: HostPerson | undefined }>()

/**
 * The git host's accounts behind these emails of a project's (`people` of its git host): what a
 * card shows as each person's picture. What it said of an email is kept a day, a miss too, so a
 * card that asks every minute asks the host once a day per person. No git host: nobody.
 */
export async function onGitHostPeople(projectId: string, emails: string[], deps: { gitHost?: GitHostFor; now?: () => number; resolve?: (projectId: string) => Promise<string | undefined> } = {}): Promise<HostPerson[]> {
  const root = await (deps.resolve ?? resolveProjectPath)(projectId)
  if (!root) return []
  const now = (deps.now ?? Date.now)()
  const key = (email: string): string => `${root}\n${email.toLowerCase()}`
  const fresh = (email: string): boolean => {
    const known = kept.get(key(email))
    return known !== undefined && now - known.at < KEEP_MS
  }
  const asking = [...new Set(emails.filter(email => typeof email === 'string' && email.includes('@')))].filter(email => !fresh(email))
  if (asking.length) {
    const host = await (deps.gitHost ?? projectGitHost)(root).catch(() => undefined)
    const found = host ? await host.people(asking).catch(() => undefined) : undefined
    // The host could not be asked (no host, or it failed): nothing is kept, so it is asked again next time.
    if (found) for (const email of asking) kept.set(key(email), { at: now, person: found.find(person => person.email.toLowerCase() === email.toLowerCase()) })
  }
  return emails.flatMap(email => kept.get(key(email))?.person ?? [])
}

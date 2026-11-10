import { errorMessage } from '@openagt/agent-data'

/**
 * A GitHub user's public profile: the name and picture a person copies into OpenAgent as their
 * own, once, when they press "Sync from GitHub". Read from GitHub's public API with no login, so
 * no account of the person's, nor of OpenAgent's, is asked.
 */

export type ProfileOutcome =
  | { ok: true; login: string; name?: string; avatar?: string }
  | { ok: false; reason: 'no-user' | 'not-reached'; detail: string }

/** What fetches the profile: `fetch` by default. */
export type ProfileFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export async function publicProfile(login: string, fetcher: ProfileFetch = fetch): Promise<ProfileOutcome> {
  let answer: { ok: boolean; status: number; json(): Promise<unknown> }
  try {
    answer = await fetcher(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'openagent' }, signal: AbortSignal.timeout(10_000) })
  } catch (err) {
    return { ok: false, reason: 'not-reached', detail: errorMessage(err) }
  }
  if (answer.status === 404) return { ok: false, reason: 'no-user', detail: `GitHub has no user ${login}` }
  if (!answer.ok) return { ok: false, reason: 'not-reached', detail: `GitHub answered ${answer.status}` }
  const body = ((await answer.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  const name = text(body['name'])
  const avatar = text(body['avatar_url'])
  return { ok: true, login: text(body['login']) ?? login, ...(name ? { name } : {}), ...(avatar?.startsWith('https://') ? { avatar } : {}) }
}

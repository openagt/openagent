import { errorMessage, type GhRunner } from './gh.js'

/**
 * Who is signed in to GitHub through `gh`: what OpenAgent shows of the person at the foot of its
 * sidebar, their login, name and picture. Asked of `gh` as `create` asks for the account.
 */

export type MeOutcome =
  | { ok: true; login: string; name?: string; avatar?: string }
  | { ok: false; reason: 'not-logged-in'; detail: string }

export async function signedIn(cwd: string, gh: GhRunner): Promise<MeOutcome> {
  let answer: Record<string, unknown>
  try {
    answer = JSON.parse(await gh(['api', 'user', '--jq', '{login: .login, name: .name, avatar: .avatar_url}'], cwd)) as Record<string, unknown>
  } catch (err) {
    return { ok: false, reason: 'not-logged-in', detail: errorMessage(err) }
  }
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  const login = text(answer['login'])
  if (!login) return { ok: false, reason: 'not-logged-in', detail: 'gh named no account' }
  const name = text(answer['name'])
  const avatar = text(answer['avatar'])
  return { ok: true, login, ...(name ? { name } : {}), ...(avatar?.startsWith('https://') ? { avatar } : {}) }
}

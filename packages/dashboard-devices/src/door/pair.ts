import { ASK_PATH } from './door.js'
import { liveAsks, type Store } from './store.js'

/**
 * Pairing on this Wi-Fi, both ends of it. This computer found another one (`devices find`) and asks
 * to get in there: it is given a number to show and a secret, and then hears by the secret whether a
 * person there allowed it, and the code it gets in with. And the other way: the asks waiting here,
 * which a page shows as a popup until someone presses Allow or Deny.
 */

/** The ask as the asking computer holds it: what it shows, and what it hears the answer by. */
export interface Asked {
  number: string
  secret: string
  expires: string
}

/** What the asking computer hears: still waiting, denied, no longer there, or allowed with the code's link. */
export type Heard = { state: 'waiting'; expires?: string } | { state: 'denied' } | { state: 'gone' } | { state: 'allowed'; link: string; numberLink?: string }

/** An ask waiting here, as a page shows it. */
export interface Waiting {
  id: string
  name: string
  number: string
  expires: string
}

/** How long a look at an ask is waited for: the door holds it open a while, and a command is given 30 seconds. */
const HEAR_MS = 25_000

/** A door found on the Wi-Fi, as a command is given it: `http://<number>:<port>`, and nothing else. */
export function doorOrigin(said: string): string | undefined {
  try {
    const url = new URL(said)
    return url.protocol === 'http:' && url.origin === said.replace(/\/$/, '') ? url.origin : undefined
  } catch {
    return undefined
  }
}

/** The door's answer, or why there is none, in words. */
async function call(url: string, init: RequestInit, ms: number): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: text.trim() || `the computer answered ${res.status}` }
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (err) {
    const why = err instanceof Error ? (err.name === 'TimeoutError' ? 'it did not answer' : err.message) : String(err)
    return { ok: false, error: why }
  }
}

/** Ask the door at `origin` to let this computer, `name`, in. */
export async function askAt(origin: string, name: string): Promise<{ ok: true; value: Asked } | { ok: false; error: string }> {
  const asked = await call(`${origin}${ASK_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ computer: name }) }, 10_000)
  if (!asked.ok) return asked
  const { number, secret, expires } = (asked.value ?? {}) as Record<string, unknown>
  if (typeof number !== 'string' || !/^\d{6}$/.test(number) || typeof secret !== 'string' || !secret || typeof expires !== 'string') return { ok: false, error: 'it answered something else than an ask' }
  return { ok: true, value: { number, secret, expires } }
}

/** Hear whether the ask was answered: the door holds the look open a while, and says so when nothing came. */
export async function hearAt(origin: string, secret: string, ms = HEAR_MS): Promise<{ ok: true; value: Heard } | { ok: false; error: string }> {
  const heard = await call(`${origin}${ASK_PATH}`, { headers: { authorization: `Bearer ${secret}` } }, ms)
  if (!heard.ok) return heard
  const { state, link, numberLink, expires } = (heard.value ?? {}) as Record<string, unknown>
  if (state === 'allowed' && typeof link === 'string' && link) return { ok: true, value: { state, link, ...(typeof numberLink === 'string' && numberLink ? { numberLink } : {}) } }
  if (state === 'waiting') return { ok: true, value: { state, ...(typeof expires === 'string' ? { expires } : {}) } }
  if (state === 'denied' || state === 'gone') return { ok: true, value: { state } }
  return { ok: false, error: 'it answered something else than an answer' }
}

/** Take this computer's ask away: the person gave up. */
export async function cancelAt(origin: string, secret: string): Promise<boolean> {
  return (await call(`${origin}${ASK_PATH}`, { method: 'DELETE', headers: { authorization: `Bearer ${secret}` } }, 10_000)).ok
}

/**
 * Who of the people whose page asks may see an ask and answer it: this computer's own screen and
 * the owner's own devices, never a device of a person the owner invited. OpenAgent says who asks,
 * by `OPENAGENT_CALLER`, only for such a person's device.
 */
export const mayAnswerAsks = (env: NodeJS.ProcessEnv): boolean => !env.OPENAGENT_CALLER

/** The asks waiting for Allow or Deny, while the door is open on the Wi-Fi. */
export function waitingAsks(store: Store, now = Date.now()): Waiting[] {
  if (!store.on || store.https) return []
  return liveAsks(store.asks, now)
    .filter(ask => ask.answer === undefined)
    .map(({ id, name, number, expires }) => ({ id, name, number, expires }))
}

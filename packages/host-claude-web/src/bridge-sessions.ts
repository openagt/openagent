import type { BridgeSession } from './bridge-endpoints.js'
import { SESSION_WINDOW_MS, sessionUrl, type WebRun } from './web-runs.js'

/**
 * Which cloud sessions the extension's Driver tab should be serving (#1237, #1332).
 *
 * Every web run's session inside the window, newest first, and all of them: one Driver tab serves
 * the whole list by reading claude.ai's own session list and visiting only the sessions that need
 * it (#1332), so a long list costs a sidebar read rather than a tab each — which is why the cap
 * of three tabs this used to impose is gone.
 *
 * Recency is the filter on this side: the session window, the same a run reads as working for.
 * The read-back that tells a session parked on its person from one finished an hour ago is the
 * list status the Driver reports, and that lives in the bridge store, not on the record.
 *
 * `queuedFor` names every session the dashboard holds an answer for. Those are served whatever
 * the window says — appended after the recent ones when no run of the window carries them —
 * because a pick is made on a question the page reported, and the page reports whichever session
 * the user happens to be on: outside the window, or no run's at all. A pick nothing serves would
 * sit queued forever.
 */
export function bridgeSessionsFrom(runs: readonly WebRun[], now: Date, queuedFor: readonly string[], windowMs = SESSION_WINDOW_MS): BridgeSession[] {
  const queued = new Set(queuedFor)
  const cutoff = now.getTime() - windowMs
  const seen = new Set<string>()
  const out: { session: BridgeSession; at: number }[] = []
  for (const { card, session } of runs) {
    if (!session) continue
    const at = Date.parse(card.startedAt)
    if (!Number.isFinite(at) || at < cutoff) continue
    if (seen.has(session.id)) continue
    seen.add(session.id)
    out.push({ session: { id: session.id, url: session.url, answerQueued: queued.has(session.id) }, at })
  }
  const recent = out.sort((a, b) => b.at - a.at).map(entry => entry.session)
  const extra = queuedFor.filter(id => !seen.has(id)).map(id => ({ id, url: sessionUrl(id), answerQueued: true }))
  return [...recent, ...extra]
}

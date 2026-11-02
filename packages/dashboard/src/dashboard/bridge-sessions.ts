import type { AgentMeta } from '../store/index.js'
import type { BridgeSession } from './bridge-endpoints.js'
import { CLOUD_SESSION_WINDOW_MS } from '../cloud-run-state.js'

/** How far back a cloud agent's session is still served: the session window, shared with its cloud state (#1668). */
export const BRIDGE_SESSION_WINDOW_MS = CLOUD_SESSION_WINDOW_MS

/**
 * Which cloud sessions the extension's Driver tab should be serving (#1237, #1332).
 *
 * Every web run's session inside the window, newest first, and all of them: one Driver tab serves
 * the whole list by reading claude.ai's own session list and visiting only the sessions that need
 * it (#1332), so a long list costs a sidebar read rather than a tab each — which is why the cap
 * of three tabs this used to impose is gone.
 *
 * Recency is still the filter on this side, because a web run's own status says nothing: #1231
 * ends the agent at the hand-off, so every one of them reads `done` whether its session is parked
 * on a question or finished an hour ago. The read-back that tells those apart is the list status
 * the Driver reports, and that lives in the bridge store, not on the record.
 *
 * `queuedFor` names every session the dashboard holds an answer for. Those are served whatever
 * the window says — appended after the recent ones when no run of the window carries them —
 * because a pick is made on a question the page reported, and the page reports whichever session
 * the user happens to be on: outside the window, or no run's at all. A pick nothing serves would
 * sit queued forever.
 */
export function bridgeSessionsFrom(
  agents: readonly AgentMeta[],
  now: Date,
  queuedFor: readonly string[],
  windowMs = BRIDGE_SESSION_WINDOW_MS,
): BridgeSession[] {
  const queued = new Set(queuedFor)
  const cutoff = now.getTime() - windowMs
  const seen = new Set<string>()
  const out: { session: BridgeSession; at: number }[] = []
  for (const agent of agents) {
    if (agent.target !== 'web' || !agent.sessionId) continue
    const at = Date.parse(agent.startedAt ?? '')
    if (!Number.isFinite(at) || at < cutoff) continue
    if (seen.has(agent.sessionId)) continue
    seen.add(agent.sessionId)
    out.push({
      session: { id: agent.sessionId, url: `https://claude.ai/code/${agent.sessionId}`, answerQueued: queued.has(agent.sessionId) },
      at,
    })
  }
  const recent = out.sort((a, b) => b.at - a.at).map(entry => entry.session)
  const extra = queuedFor.filter(id => !seen.has(id)).map(id => ({ id, url: `https://claude.ai/code/${id}`, answerQueued: true }))
  return [...recent, ...extra]
}

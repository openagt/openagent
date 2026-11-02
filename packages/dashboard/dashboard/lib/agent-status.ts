import type { OpenAgentEvent } from '../../src/index.js'
import { isAgentActive, agentOutcome } from './live-state.js'

/**
 * How an agent's one status pill is drawn: its dot colour, its word, the word's tone, and, for a
 * failure, the reason apart from the word.
 */
export type AgentStatusPill = { dot: string; label: string; tone: string; detail?: string }

/**
 * The single status an agent is in, read off its feed, or null while the feed has no line.
 *
 * The states are deliberately exclusive: one agent, one word. How the current leg ENDED decides
 * it (#948): failed, stopped, or waiting for an answer. With no ending the agent builds while it
 * is live, and has finished otherwise.
 */
export function agentStatusPill(events: OpenAgentEvent[]): AgentStatusPill | null {
  if (events.length === 0) return null
  const outcome = agentOutcome(events)
  const failed = outcome !== undefined && !outcome.ok && !outcome.stopped && !outcome.waiting
  if (failed) {
    return { dot: 'bg-danger', label: 'failed', tone: 'text-danger', ...(outcome?.detail ? { detail: outcome.detail } : {}) }
  }
  if (outcome?.stopped) return { dot: 'bg-warning', label: 'stopped', tone: 'text-warning' }
  if (outcome?.waiting) return { dot: 'bg-warning', label: 'waiting for an answer', tone: 'text-warning' }
  // An agent only pulses "building…" while it is live (#695/U20): once its end lands the pill settles.
  if (isAgentActive(events)) return { dot: 'animate-pulse bg-warning', label: 'building…', tone: 'text-muted-foreground' }
  return { dot: 'bg-muted-foreground', label: 'finished', tone: 'text-muted-foreground' }
}

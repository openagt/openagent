import type { AgentMeta } from '../../src/index.js'
import type { RunEvent } from '@openagt/hooks'

// Live-run state derived from the event stream — kept pure so it can be driven and
// tested on its own, away from React. The dashboard is a projection of the diary the
// run's tool writes; the question panel and the Stop button read that projection rather
// than any extra state.

export { pendingChoices } from '../../src/client.js'

/**
 * Whether the agent is still going, i.e. worth showing a Stop button. An agent ends with a
 * single `end` event; until one arrives (and once anything has streamed) it is live.
 */
export function isAgentActive(events: readonly RunEvent[]): boolean {
  // Asked of the CURRENT segment, not the whole feed: a resumed session (#762) appends a second
  // `session` boundary after its `end` to the same journal, and "was there ever an end" read a
  // resumed-live run as inactive — hiding Stop and settling the pill while the agent worked.
  const current = currentAgentEvents(events)
  return current.length > 0 && !current.some(event => event.kind === 'end')
}

/** How an agent ended, off its single `end` event. */
export interface AgentOutcome {
  ok: boolean
  stopped: boolean
  /** The agent ended on a question and waits for the answer to resume it. */
  waiting?: boolean
  detail?: string
}

/**
 * The agent's ending, or undefined while it is still going (#948). The most important bit
 * about a finished agent used to live only in one small `✗ failed` feed line — the overview
 * pill said "finished" for a crash and a clean pass alike.
 */
export function agentOutcome(events: readonly RunEvent[]): AgentOutcome | undefined {
  // The ending of the CURRENT segment: a resumed session (#762) carries its stopped segment's
  // `end` in the same journal, and the first-end-wins read kept a resumed agent "stopped" for
  // ever — while it was live again, and even after it later finished clean. Mid-resume there is
  // no end in the newest segment yet, and "undefined while it is still going" is the truth.
  const end = currentAgentEvents(events).find(event => event.kind === 'end')
  if (!end || end.kind !== 'end') return undefined
  return { ok: end.ok, stopped: end.stopped === true, ...(end.waiting === true ? { waiting: true } : {}), ...(end.detail !== undefined ? { detail: end.detail } : {}) }
}

/**
 * How the run's card says the agent ended, or undefined while it runs. It stands in for
 * {@link agentOutcome} until the agent's events are read, and for a run whose process died
 * before writing its ending.
 */
export function cardOutcome(status: AgentMeta['status']): AgentOutcome | undefined {
  if (status === 'running') return undefined
  return { ok: status === 'done', stopped: status === 'stopped', ...(status === 'waiting' ? { waiting: true } : {}) }
}

/**
 * The current leg's slice of a run's feed. A run that is continued (its question answered, a
 * message after it ended) keeps writing into the same diary, so the feed holds the ended leg,
 * its `end` included, followed by the new one. The boundary is the last `end` the agent went on
 * after (any later event of the agent's own), or the last `session` event, which opens the legs
 * of older records. Keep only the tail from there: that is the leg in progress, and "how did it
 * end" must not answer with a leg the run has since left behind (#762). A feed with no boundary
 * is returned whole.
 */
export function currentAgentEvents(events: readonly RunEvent[]): RunEvent[] {
  let start = 0
  let wentOn = false
  for (let i = events.length - 1; i >= 0; i--) {
    const kind = events[i]?.kind
    if (kind === 'session') {
      start = i
      break
    }
    if (kind === 'end' && wentOn) {
      start = i + 1
      break
    }
    if (kind === 'driver') wentOn = true
  }
  return events.slice(start)
}

/**
 * The state a run's page says it is in, as the run table names it (`run-words.ts`): waiting while a
 * question waits on the person, running while it works, merged once its pull request is, else how
 * it ended; undefined while none of that is known.
 */
export function shownStatus(working: boolean | null, asking: boolean, outcome: AgentOutcome | undefined, merged: boolean): string | undefined {
  if (asking || outcome?.waiting) return 'waiting'
  if (working) return 'running'
  if (merged) return 'merged'
  if (!outcome) return undefined
  return outcome.stopped ? 'stopped' : outcome.ok ? 'done' : 'failed'
}

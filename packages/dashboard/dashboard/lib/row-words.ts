import type { DriverEvent } from '@openagt/agent-driver'
import type { OpenAgentEvent } from '../../src/index.js'

/**
 * The chat's own words for the rows that are neither a message, a step, nor a card: how a run
 * ended, what it reported, where its work is, what the model's quota is doing.
 *
 * The terminal writes those lines for a terminal — `■ stopped`, `  branch: fix-the-thing`,
 * `✗ quota exhausted (five_hour), resets 2026-10-16T18:30:00.000Z` — with a glyph for the kind,
 * two spaces for depth and a machine's spelling of a time. In a chat none of that reads: there is
 * no column to indent into, nobody is told what ■ means, and a reader wants the time on their own
 * clock. So each kind says itself here in the shape the rest of the chat already uses: a grey word
 * for what happened and, when there is one, the thing it happened to in the page's own colour,
 * which is how a tool call's row reads.
 *
 * A kind this does not name falls back to the terminal's line, so nothing can render as nothing.
 */
export interface RowWords {
  /** What happened, in grey. Wraps: a log line is a sentence, not a label. */
  said: string
  /** What it happened to, in the page's own colour: a branch, a number, a time. One line. */
  thing?: string
  /** Where `thing` leads, when it is a place to open. */
  href?: string
  /** More, under the row: what an error has to say for itself. */
  detail?: string
}

/** The chat's words for one event, or nothing when the terminal's line is what it says. */
export function rowWords(e: OpenAgentEvent): RowWords | undefined {
  switch (e.kind) {
    case 'end':
      // A clean end and an end waiting on an answer are no rows at all: the agent's own last
      // message is how such a turn ends, and the chat drops them before this is asked.
      if (e.stopped) return { said: 'Stopped' }
      // Why it failed is a reason, not a name: it belongs in the sentence, not beside it.
      if (!e.ok && !e.waiting) return { said: `Failed — ${e.detail ?? 'unknown error'}` }
      return undefined
    case 'error':
      return { said: e.headline, ...(e.detail !== undefined && e.detail !== '' ? { detail: e.detail } : {}) }
    case 'settled':
      return { said: 'Done for now — waiting for your next message' }
    case 'branch':
      return { said: 'Branch', thing: e.branch }
    case 'pull-request':
      return { said: 'Pull request', thing: `#${e.number}`, href: e.url }
    case 'cloud-anchor':
      return { said: 'Handed off at', thing: e.sha.slice(0, 7) }
    case 'log':
      return { said: e.message }
    case 'intent':
      return { said: 'Asked for', thing: e.text }
    case 'driver':
      return driverWords(e.event)
    default:
      return undefined
  }
}

function driverWords(event: DriverEvent): RowWords | undefined {
  switch (event.type) {
    case 'notice':
      return { said: event.message }
    case 'error':
      return { said: 'The agent reported an error', detail: event.message }
    case 'rate-limit': {
      // The reading is a row only when the quota is tight (EventList drops the rest), and the
      // time it comes back is said on the reader's own clock, not in the machine's spelling.
      const window = event.limit.window.replace(/_/g, '-')
      const resets = `resets ${new Date(event.limit.resetsAt).toLocaleString()}`
      if (event.limit.status === 'rejected') return { said: `The ${window} quota is used up`, thing: resets }
      if (event.limit.status === 'allowed_warning') return { said: `The ${window} quota is running low`, thing: resets }
      return undefined
    }
    default:
      return undefined
  }
}

import type { OpenAgentEvent } from './events.js'

// Derived agent state for the dashboard's overview cards (#431): the errors a run hit and the
// live session link — each a pure projection of the same OpenAgentEvent stream the log renders,
// so the live dashboard and a past-agent replay show the identical summary. Kept here (not in the
// dashboard) so it is unit-tested against the real event shapes.

/** One error of a run: one the agent reported through an `error` block (#1500), or one its tool wrote in the diary. */
export interface AgentError {
  /** What is wrong, in one line. */
  headline: string
  /** What it ran and what that said, when the agent wrote any. */
  detail?: string
}

/**
 * Every error of the run (#1500), oldest first — the count the dashboard shows on the session, and
 * the latest headline it shows beside it. Two sources: the `error` lines the run's tool writes in
 * the diary when the coding agent or its transport fails (the message's first line is the
 * headline, the rest the detail), and the `error` blocks of runs recorded before the daemon
 * stopped running agents.
 *
 * A fold over the log rather than state of its own: an error is an event that happened, so the
 * list only ever grows, and reopening a finished agent shows exactly what it showed while it ran.
 */
export function agentErrors(events: readonly OpenAgentEvent[]): AgentError[] {
  const errors: AgentError[] = []
  for (const event of events) {
    if (event.kind === 'error') {
      errors.push({ headline: event.headline, ...(event.detail ? { detail: event.detail } : {}) })
    } else if (event.kind === 'driver' && event.event.type === 'error' && typeof event.event.message === 'string') {
      const [headline = '', ...rest] = event.event.message.trim().split('\n')
      const detail = rest.join('\n').trim()
      errors.push({ headline: headline || 'error', ...(detail ? { detail } : {}) })
    }
  }
  return errors
}

/** The wrapped agent session (#431): its id and a deep link, when one is known. */
export interface SessionInfo {
  sessionId?: string
  sessionLink?: string
  /**
   * The directory the agent ran in (#1195), from the opening `session` event.
   *
   * Taken from the event rather than the filesystem on purpose: an agent that finishes cleanly has
   * its worktree removed (`tearDownWorktree`), so the event is the only surviving record of where
   * the session lived — and that path is exactly what `claude --resume` needs to find it again.
   */
  workspace?: string
}

/**
 * The session behind the agent (#431): the workspace from the opening `session`
 * event, then the id and any deep link from the latest `session-update`. Null before the
 * session opens. The link is what the old dashboard surfaced as "open session".
 */
export function sessionInfo(events: readonly OpenAgentEvent[]): SessionInfo | null {
  let info: SessionInfo | null = null
  for (const event of events) {
    if (event.kind === 'session') {
      info = {
        workspace: event.workspace,
        ...(event.sessionLink ? { sessionLink: event.sessionLink } : {}),
      }
    } else if (event.kind === 'session-update') {
      info = { ...(info ?? {}), sessionId: event.sessionId, ...(event.sessionLink ? { sessionLink: event.sessionLink } : {}) }
    }
  }
  return info
}

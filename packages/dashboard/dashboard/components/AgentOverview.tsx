import type { OpenAgentEvent } from '../../src/index.js'
import { sessionInfo } from '../../src/client.js'
import { AgentErrorCount, errorsToCount } from './AgentErrorCount.js'
import { agentStatusPill } from '../lib/agent-status.js'
import { describeSessionLink } from '../lib/session-link.js'
import { cn } from '../lib/utils.js'

// The agent overview (#431): the "moat" the wrapped agent's own chat cannot show, rebuilt
// on the new dashboard. Each card is a pure projection of the event stream
// (`src/agent-view.ts`) — the agent's status and a link
// to the live session. Cards render only when their data has arrived, so an early agent
// shows nothing extra.
export function AgentOverview({ events }: { events: OpenAgentEvent[] }) {
  const session = sessionInfo(events)
  const status = agentStatusPill(events)
  const errors = errorsToCount(events)

  // The "Open session" link, labeled honestly: a headless Claude Code run has no per-session
  // URL, so the generic app entry (claude.ai/code) is shown as "Open Claude Code" with the id
  // surfaced separately, not as a deep link to that id. See {@link describeSessionLink}.
  const sessionLink = describeSessionLink(session)

  if (!sessionLink && !status && errors.length === 0) return null

  return (
    <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2">
      {status && (
        <div className="flex items-center gap-2 text-sm md:col-span-2">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', status.dot)} aria-hidden />
          {/* The summary block has room for the whole reason, so it says it. */}
          <span className={cn('text-xs', status.tone)}>{status.detail ? `${status.label} — ${status.detail}` : status.label}</span>
        </div>
      )}
      {/* What went wrong, kept where the log cannot scroll it away (#1500). The rows themselves
          stay in the log, at the point in the run where the agent hit them. */}
      {errors.length > 0 && (
        <div className="text-sm md:col-span-2">
          <AgentErrorCount events={events} headline />
        </div>
      )}
      {sessionLink && (
        <a
          href={sessionLink.href}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline underline-offset-2 md:col-span-2"
        >
          {sessionLink.label}
        </a>
      )}
    </div>
  )
}

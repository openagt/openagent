import type { ReactNode } from 'react'
import type { AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { TriangleAlert } from 'lucide-react'
import { EventList } from './EventList.js'
import type { SessionSetup } from './SessionLine.js'

// One agent's feed: the live/replayed event log, or a waiting placeholder before anything has
// streamed. Rendered by the agent's own view (AgentView), whose action bar already carries the
// session link, the session name and the status. `lost` is the live channel's health (#948):
// while the stream is down the feed is behind reality, and saying so beats letting "the agent
// went quiet" and "the connection died" look identical.
export function AgentFeed({
  events,
  lost = false,
  writing = '',
  sending,
  working = false,
  queued,
  waitingOn,
  stick = true,
  openAt,
  emptyLabel = 'Waiting for the session to start…',
  tail,
  projectId,
  subagents,
  doing,
  setup,
  onOpenAgent,
  onOpenChange,
  onOpenScreen,
}: {
  events: OpenAgentEvent[]
  /** The feed's own project: with it, an answered question is its ✓ card and an open one is no
   *  row, since the agent's page asks it above the message box. Required, so no caller shows an
   *  open question as log text by leaving it out. */
  projectId: string
  lost?: boolean
  /** The message the agent is writing, as far as it has got: a row after the last, growing as it comes. */
  writing?: string
  /** A message just sent to an ended agent, shown as the last prompt until its own line arrives. */
  sending?: string | undefined
  /** The agent is working: a spinner row closes the feed while it writes nothing. */
  working?: boolean
  /** Messages the working agent has not read yet, and how many subagents an ended turn waits on: the feed's last rows. */
  queued?: readonly string[] | undefined
  waitingOn?: number | undefined
  /** A finished log is static (#1026): it does not follow new output, and opens at its end. */
  stick?: boolean
  openAt?: 'start' | 'end'
  /** What an empty feed says: a live agent is waiting, a finished one has nothing to replay. */
  emptyLabel?: string
  /** Rendered after the last log row, inside the scroller (#1265): a web agent's live mirror box. */
  tail?: ReactNode
  /** The run's subagents, what each is doing now, and how a click on one's row opens it. */
  subagents?: readonly AgentMeta[] | undefined
  doing?: Record<string, string> | undefined
  /** What was set up for the agent before it began: the chat's "Session set up" line. */
  setup?: SessionSetup | undefined
  onOpenAgent?: ((agentId: string) => void) | undefined
  /** Show a changed file's change: a click on a file's row at the end of a turn. */
  onOpenChange?: ((path: string) => void) | undefined
  /** Show the run's live screen: what the row of a live screen does on a click. */
  onOpenScreen?: (() => void) | undefined
}) {
  const lostBanner = lost && (
    <div role="status" className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Live stream lost — reconnecting. The session keeps running; this view may be behind.
    </div>
  )
  // A message that waits is a row too: with no event yet it is the feed's only one.
  if (events.length === 0 && sending === undefined && !queued?.length) {
    return (
      <>
        {lostBanner}
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">{emptyLabel}</div>
      </>
    )
  }
  return (
    <>
      {lostBanner}
      <EventList
        events={events}
        writing={writing}
        {...(sending !== undefined ? { sending } : {})}
        working={working}
        {...(queued ? { queued } : {})}
        {...(waitingOn ? { waitingOn } : {})}
        stick={stick}
        {...(openAt ? { openAt } : {})}
        {...(tail ? { tail } : {})}
        projectId={projectId}
        {...(subagents ? { subagents } : {})}
        {...(doing ? { doing } : {})}
        setup={setup}
        onOpenAgent={onOpenAgent}
        onOpenChange={onOpenChange}
        onOpenScreen={onOpenScreen}
      />
    </>
  )
}

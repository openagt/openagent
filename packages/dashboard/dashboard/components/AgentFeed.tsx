import type { ComponentProps } from 'react'
import { ChatNote } from './ChatPane.js'
import { EventList } from './EventList.js'

// One agent's feed: the live/replayed event log, or a waiting placeholder before anything has
// streamed. Rendered by the agent's own view (AgentView), whose action bar already carries the
// session link, the session name and the status.
export function AgentFeed({
  emptyLabel = 'Waiting for the session to start…',
  ...log
}: ComponentProps<typeof EventList> & {
  /** The feed's own project and agent: with them, an answered question is its ✓ card and an open
   *  one is the question's card, answered in place. Required, so no caller shows an open question
   *  as log text by leaving them out. */
  projectId: string
  agentId: string | undefined
  /** What an empty feed says: a live agent is waiting, a finished one has nothing to replay. */
  emptyLabel?: string
}) {
  // A message that waits is a row too: with no event yet it is the feed's only one.
  if (log.events.length === 0 && log.sending === undefined && !log.queued?.length) return <ChatNote>{emptyLabel}</ChatNote>
  return <EventList {...log} />
}

import { useEffect, useState } from 'react'
import type { OpenAgentEvent } from '../../src/index.js'
import { onAgent } from '../rpc/reads.js'
import { agentLogKey } from './agent-log.js'
import { isAgentActive } from './live-state.js'
import { useLoaded } from './use-async.js'

// The log an agent's page shows (#1026), whether the agent is running or finished: while it is live
// the log arrives over the channel, and once it ends the archived copy is read and swapped in
// behind the events already on screen.

/**
 * The log to show for one agent, given its live channel's `events` and whether it is still running
 * (`live`; `null` while the list of agents has not been read).
 */
export function useAgentFeed(
  projectId: string,
  agentId: string,
  live: boolean | null,
  events: OpenAgentEvent[],
): {
  /** The archived log, once read: `null` while the agent works, and until the read has answered. */
  archived: OpenAgentEvent[] | null
  /** The events the page shows. */
  shown: OpenAgentEvent[]
  /** The shown log's current leg has not ended. */
  active: boolean
  /** Live as the feed knows it, which can be before the list of agents does. */
  feedLive: boolean
} {
  const working = live === true
  // The archived log, read only once the agent has ended: while it runs, the channel is the truth.
  // `archiveBehind` re-reads it whenever the live channel has outgrown the copy on screen (#1460):
  // a resumed session streams new events while `live` is still false for a poll round-trip, and a
  // line written as a clean run is recorded only ever lands in the archive — its worktree journal is
  // torn down with the worktree — so without this the PR line waited for a manual refresh.
  const [archiveBehind, setArchiveBehind] = useState(0)
  const archived = useLoaded<OpenAgentEvent[] | null>(
    live === false ? () => onAgent(projectId, agentId) : null,
    null,
    [projectId, agentId, live, archiveBehind],
    // Going back to an ended run shows its log at once, as last read, while it is read again.
    { remember: agentLogKey(projectId, agentId) },
  )
  // The page is mounted un-keyed, so switching agents only swaps props: a stale `archiveBehind`
  // can swallow the catch-up re-read on an equal-length collision.
  useEffect(() => setArchiveBehind(0), [agentId])

  // The events already on screen keep their place while the archived copy is read, so an agent
  // ending swaps the source without blanking the output. An EMPTY archive never replaces them
  // either (#1383): `onAgent` answers `[]` both for "gone" and for "not archived yet", and a Stop
  // races the archive write — swapping the live feed for that `[]` blanked the view to "This
  // session has no events." until a manual refresh.
  //
  // A STALE archive never wins either (#1460): on Resume the channel streams the new leg while
  // `live` waits on the 2s runs poll, and serving the frozen archive for that window is what made
  // the whole continuation land in one jolting commit — or, when the poll lost the race entirely,
  // not render at all until a refresh. The channel is preferred the moment it knows more; the
  // archive is re-read behind it (`archiveBehind` above) and takes back over once it has caught
  // up, which is also how the epilogue's archive-only events reach the screen.
  //
  // "Knows more" is only trustworthy when the channel is this agent's OWN journal. It is not
  // guaranteed to be: the page is not mounted anew for another agent, and until the channel is
  // reset for it, its events are the agent before's — a longer foreign feed must never beat the
  // agent's archive. The archive is the agent's own record, so its opening event is the
  // fingerprint the channel has to match; an unloaded or empty archive can't be checked and keeps
  // the pre-existing show-the-feed fallback.
  const sameJournal =
    !archived?.length || events.length === 0 || JSON.stringify(events[0]) === JSON.stringify(archived[0])
  const feedAhead = sameJournal && events.length > (archived?.length ?? 0)
  const shown = working ? events : archived?.length && !feedAhead ? archived : events
  useEffect(() => {
    if (live === false && archived !== null && feedAhead) setArchiveBehind(events.length)
  }, [live, archived, feedAhead, events.length])

  // Live as the FEED knows it (#1460): the agents poll takes up to 2s to notice a resumed session,
  // but its events are already streaming. The feed's own verdict drives the scroll contract and
  // the composer slot, so the continuation renders (and Stop takes over from Resume) the moment
  // the first event lands rather than when the poll does.
  //
  // Once the feed has shown the run going again, it keeps saying so until the log shows that turn
  // end: the archive re-read above catches up with the channel within milliseconds, the channel
  // then knows no more than it, and without this the page said "ended" again until the poll
  // landed, the spinner row flashing in between. Only a turn seen starting past an
  // archive that was read counts: before the first read the channel is ahead of nothing.
  const [resumedFor, setResumedFor] = useState<string | null>(null)
  const active = isAgentActive(shown)
  const feedLive = working || (active && (feedAhead || resumedFor === agentId))
  useEffect(() => {
    if (active && feedAhead && archived !== null) setResumedFor(agentId)
    else if (!active) setResumedFor(null)
  }, [active, feedAhead, archived, agentId])

  return { archived, shown, active, feedLive }
}

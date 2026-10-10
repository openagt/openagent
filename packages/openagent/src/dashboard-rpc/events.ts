import { fromDiaryLine, resolveAgentDiary, type AgentDiarySource, type AnyDiaryLine } from '../store/index.js'
import { contextEventsSource, resolveProjectPath } from './context.js'
import type { OpenAgentEvent } from '../events.js'
import { partialReader, tailAgentEvents } from './events-tail.js'
import { forwardStream } from './stream-forward.js'

// The live event stream behind the dashboard (#405): the selected run's diary, the file the run's
// tool writes as the agent works. Each new line becomes one `send(event)`, which the mount writes
// out as one SSE frame. Runs, docs, and the project log come over the read-model RPCs (reads.ts).

/** The diary to follow, or undefined when the project or the run is unknown. */
async function resolveEventsDiary(projectId: string, agentId?: string, opts: { cached?: boolean } = {}): Promise<AgentDiarySource | undefined> {
  const cwd = await resolveProjectPath(projectId)
  return cwd ? resolveAgentDiary(cwd, agentId, undefined, undefined, opts) : undefined
}

/**
 * The end-of-replay marker (#1383). A subscribe replays the whole log before following live,
 * and without a boundary a reconnecting client cannot tell "replay still streaming" from "the
 * log is genuinely this short" — so it blanked a populated feed and refilled it line by line.
 * Sent once per subscription, after the on-disk replay is delivered. Wire-only: it is not a
 * {@link OpenAgentEvent}, is never written to any journal, and the client swallows it.
 */
export type StreamSync = { kind: 'stream-sync' }

/**
 * The message the agent is writing, as far as it has got (the run's live file, beside its diary);
 * empty once there is none. Wire-only like {@link StreamSync}: the pieces are never in the diary,
 * and the page shows them until the whole message's line arrives.
 */
export type PartialMessage = { kind: 'partial'; text: string }

/** What `onEvents` streams: the agent's events, plus the wire-only end-of-replay marker and partial message. */
export type LiveFeedEvent = OpenAgentEvent | StreamSync | PartialMessage

/**
 * Follow one agent's events: `send` is called per event until the returned stop function runs.
 * Returns undefined when there is nothing to stream (an unknown project), which the mount ends as
 * a clean close — mirroring the read model's empty results rather than throwing at the client.
 *
 * The `agentId` names the run whose diary is followed; without one there is nothing to stream.
 *
 * Two sources, chosen by what is wired. An in-memory stream wins: an agent the daemon is relaying
 * from a machine (#1067). Otherwise the on-disk log. The daemon's source answers only for relayed
 * runs, so an ordinary local agent falls through to tailing the log.
 *
 * Only the on-disk tail sends the {@link StreamSync} marker: the in-memory sources have no replay
 * boundary to report, so a reconnecting client falls back to a grace deadline before swapping its
 * feed (see use-live-events in the dashboard).
 */
export async function streamAgentEvents(
  projectId: string,
  agentId: string | undefined,
  send: (value: LiveFeedEvent) => void,
  onDone?: () => void,
): Promise<(() => void) | undefined> {
  const stream = contextEventsSource()(projectId, agentId)
  // An in-memory agent: replay + follow it, and end when it ends — a relayed agent that finished has
  // nothing more to say, and leaving the response open would read as a live feed gone quiet.
  if (stream) return forwardStream(stream, send, onDone)

  // Everywhere else: tail the run's diary. The relocating tail, because the diary moves
  // mid-subscription: when the run ends its tool records it and reclaims the checkout, and a
  // fixed-path tail whose fs.watch missed the final appends went silent without the run's `end`.
  // On the move it asks again and sends the finished run's lines it had not sent, so the feed
  // gets exactly the lines the move would have swallowed.
  if ((await resolveEventsDiary(projectId, agentId)) === undefined) return undefined
  return tailAgentEvents<AnyDiaryLine>(
    opts => resolveEventsDiary(projectId, agentId, opts),
    line => {
      const event = fromDiaryLine(line)
      if (event) send(event)
    },
    () => send({ kind: 'stream-sync' }),
    partialReader(text => send({ kind: 'partial', text })),
  )
}

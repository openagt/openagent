import { useEffect, useMemo, useState } from 'react'
import type { OpenAgentEvent } from '../../src/index.js'
import type { LiveFeedEvent } from '../../src/dashboard-rpc/index.js'
import { onEvents, type EventChannel } from '../rpc/events.js'
import { currentAgentEvents } from './live-state.js'

// The live agent feed (#405), shared. The dashboard is a projection of the selected run's diary,
// the file the run's own tool writes as the agent works, streamed over Server-Sent Events that
// push one `OpenAgentEvent` per new line. Both the main event view and the right rail's choice
// gates (#440) read this same stream, so the subscription lives here and each consumer owns one
// channel rather than opening a second.
//
// The feed is per RUN, not per project (#749): each run has a diary of its own, so the selected
// run's id picks the file to follow. Changing it resubscribes, which is what makes selecting run A
// vs run B show different output. Without an id there is nothing to follow and the server closes
// the channel at once.

/** The live feed plus whether its channel is currently down (#948). */
export interface LiveEvents {
  events: OpenAgentEvent[]
  /** True while the stream is lost and being retried — the feed may be behind reality. */
  lost: boolean
  /** The server closed the channel on purpose (relay stream ended, unknown run) — final. */
  done: boolean
  /** The message the agent is writing, as far as it has got; empty when it is writing none. Never in `events`. */
  writing: string
}

/** Retry delays for a lost stream: quick first, then settle at a slow poll. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000]

function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] as number
}

/**
 * How long a reconnect waits for the server's end-of-replay marker before swapping anyway
 * (#1383). The on-disk tail sends `stream-sync` the moment its replay is delivered, so this
 * deadline only fires for the in-memory sources (relay #426, relayed machine runs #1067),
 * which have no replay boundary to report — their buffered history streams in well under it.
 */
const SYNC_GRACE_MS = 1500

export function useLiveEvents(projectId: string | null, agentId?: string | null, resetKey?: unknown): LiveEvents {
  const [events, setEvents] = useState<OpenAgentEvent[]>([])
  const [lost, setLost] = useState(false)
  const [done, setDone] = useState(false)
  const [writing, setWriting] = useState('')

  // Drop the accumulated feed at a run boundary the caller knows about (a fresh Start bumps
  // `resetKey`), WITHOUT tearing down the subscription. The new run's diary appears a beat later,
  // so until its first line streams the buffer would otherwise still hold the finished run —
  // which the jump-to-live view (#705) would show. Clearing here means the pane waits empty for
  // the new run instead, and the live tail streams it in as soon as its diary exists.
  useEffect(() => {
    setEvents([])
    setWriting('')
  }, [resetKey])

  useEffect(() => {
    setEvents([])
    setLost(false)
    setDone(false)
    setWriting('')
    if (!projectId) return
    let channel: EventChannel | undefined
    let cancelled = false
    let attempt = 0
    let first = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined

    // A dead stream used to be silent: the daemon restarts, events just stop, and "the agent
    // went quiet" is indistinguishable from "the feed died" (#948). Now an errored close (or a
    // failed subscribe) flips `lost` and retries with backoff. A clean close is the server being
    // done with the channel on purpose (relay stream ended, unknown project) — not an outage —
    // so it neither retries nor alarms, matching the old behavior.
    const retry = () => {
      if (cancelled) return
      setLost(true)
      timer = setTimeout(subscribe, retryDelay(attempt++))
    }

    const subscribe = () => {
      // Every subscribe replays the whole log before following live. The FIRST one streams into
      // a pane this effect just cleared, so it renders as it arrives. A RECONNECT has a populated
      // feed on screen, and blanking it while history re-streamed was #1383's mid-run flicker:
      // the lost banner cleared on resubscribe, then the feed sat empty until the replay caught
      // up. So a reconnect buffers the replay and swaps atomically — on the server's stream-sync
      // marker, or at a grace deadline for the in-memory sources that send none. The feed never
      // shows less than it already showed (#1402's rule, applied to the live channel).
      const reconnect = !first
      first = false
      void onEvents(projectId, agentId ?? undefined).then(ch => {
        if (cancelled) {
          void ch.close()
          return
        }
        channel = ch
        attempt = 0
        setLost(false)
        let buffer: OpenAgentEvent[] | undefined = reconnect ? [] : undefined
        // The whole message just arrived: its pieces, read a beat late, would show it twice.
        let finished = ''
        const swap = () => {
          if (cancelled || buffer === undefined) return
          const replay = buffer
          buffer = undefined
          setEvents(replay)
        }
        // The deadline swaps what the replay has brought. With nothing brought yet there is nothing
        // to swap in: the feed on screen stays, and the deadline runs again from the first event.
        let graceSpent = false
        const atGrace = () => {
          if (buffer !== undefined && buffer.length === 0) graceSpent = true
          else swap()
        }
        if (reconnect) graceTimer = setTimeout(atGrace, SYNC_GRACE_MS)
        else setEvents([]) // fresh subscribe: start clean so the replay is not appended twice
        ch.listen(event => {
          if (event.kind === 'stream-sync') {
            if (graceTimer) clearTimeout(graceTimer)
            swap()
            return
          }
          if (event.kind === 'partial') {
            setWriting(event.text === finished ? '' : event.text)
            return
          }
          // A whole message replaces its pieces, and a run that ended writes nothing more.
          if ((event.kind === 'driver' && event.event.type === 'text') || event.kind === 'end') {
            finished = event.kind === 'driver' && event.event.type === 'text' ? event.event.text : ''
            setWriting('')
          }
          if (buffer) {
            buffer.push(event)
            if (graceSpent) {
              graceSpent = false
              graceTimer = setTimeout(swap, SYNC_GRACE_MS)
            }
          } else setEvents(prev => [...prev, event])
        })
        ch.onClose(err => {
          // A close mid-replay drops the partial buffer: swapping it in would be exactly the
          // collapse this exists to prevent, and the next attempt replays from the top anyway.
          buffer = undefined
          if (graceTimer) clearTimeout(graceTimer)
          if (err) retry()
          else if (!cancelled) setDone(true)
        })
      }, retry)
    }

    subscribe()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      void channel?.close()
    }
    // agentId is a dependency: selecting another agent must resubscribe to that agent's log (#749).
  }, [projectId, agentId])

  // Scope the accumulated feed to the agent in progress — but only for the project-root fallback:
  // that subscription lives across run boundaries (it only resets on a project switch), so
  // without the slice a second agent would show the previous agent's log until it finished. An agent's
  // own tail (#749) holds nothing but that agent — including the second `session` boundary a
  // resumed session (#762) appends to the SAME journal, where slicing is exactly wrong: it hid
  // everything before the resume for as long as the agent was live. See {@link currentAgentEvents}.
  const scoped = useMemo(() => (agentId ? events : currentAgentEvents(events)), [events, agentId])
  return { events: scoped, lost, done, writing }
}

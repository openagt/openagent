import { useEffect, useState } from 'react'
import type { OpenAgentEvent } from '../../src/index.js'
import { onEvents, type EventChannel } from '../rpc/events.js'

// The live agent feed (#405), shared. The dashboard is a projection of the selected run's diary,
// the file the run's own tool writes as the agent works, streamed over Server-Sent Events that
// push one `OpenAgentEvent` per new line. Both the main event view and the choice
// gates (#440) read this same stream, so the subscription lives here and each consumer owns one
// channel rather than opening a second.
//
// The feed is per RUN, not per project (#749): each run has a diary of its own, so the selected
// run's id picks the file to follow. Changing it resubscribes, which is what makes selecting run A
// vs run B show different output. Without an id there is nothing to follow (the daemon streams no
// run for none), so nothing is subscribed.

/** The live feed plus whether its channel is currently down (#948). */
export interface LiveEvents {
  events: OpenAgentEvent[]
  /** True while the stream is lost and being retried — the feed may be behind reality. */
  lost: boolean
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

export function useLiveEvents(projectId: string | null, agentId?: string | null): LiveEvents {
  const [events, setEvents] = useState<OpenAgentEvent[]>([])
  const [lost, setLost] = useState(false)
  const [writing, setWriting] = useState('')

  // Another run, or one just started, is a feed of its own: it starts empty, and the live tail
  // streams the run in as soon as its diary exists.
  useEffect(() => {
    setEvents([])
    setLost(false)
    setWriting('')
    if (!projectId || !agentId) return
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
      void onEvents(projectId, agentId).then(ch => {
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
        // A message comes in blocks, each written from its start, and a block's whole line may come a
        // beat after the next block's pieces: the block before stays shown until its line has come,
        // so it does not go and come back. The next block's pieces wait for it.
        let lastPiece = ''
        let held = ''
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
            const text = event.text === finished ? '' : event.text
            const before = lastPiece
            lastPiece = text
            if (held === '' && before !== '' && text !== '' && !text.startsWith(before.slice(0, 40)) && before !== finished) held = before
            if (held === '') setWriting(text)
            return
          }
          // A whole message replaces its pieces, and a run that ended writes nothing more. The whole
          // line of a block held on screen lets the next block's pieces show.
          if (event.kind === 'driver' && event.event.type === 'text' && held !== '' && event.event.text.startsWith(held.slice(0, 40))) {
            finished = event.event.text
            held = ''
            setWriting(lastPiece.startsWith(finished.slice(0, 40)) ? '' : lastPiece)
          } else if ((event.kind === 'driver' && event.event.type === 'text') || event.kind === 'end') {
            finished = event.kind === 'driver' && event.event.type === 'text' ? event.event.text : ''
            held = ''
            lastPiece = ''
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

  // An agent's own tail (#749) holds nothing but that agent, so the feed is its whole log: also the
  // second `session` boundary a resumed session (#762) appends to the SAME journal, where slicing
  // at the last one hid everything before the resume for as long as the agent was live.
  return { events, lost, writing }
}

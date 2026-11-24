import { useEffect, useState } from 'react'
import type { RunEvent } from '@openagt/hooks'
import { onEvents, type EventChannel } from '../rpc/events.js'
import { rememberUnder, rememberedUnder } from './use-async.js'

// The live agent feed (#405), shared. The dashboard is a projection of the selected run's diary,
// the file the run's own tool writes as the agent works, streamed over Server-Sent Events that
// push one `RunEvent` per new line. Both the main event view and the choice
// gates (#440) read this same stream, so the subscription lives here and each consumer owns one
// channel rather than opening a second.
//
// The feed is per RUN, not per project (#749): each run has a diary of its own, so the selected
// run's id picks the file to follow. Changing it resubscribes, which is what makes selecting run A
// vs run B show different output. Without an id there is nothing to follow (the daemon streams no
// run for none), so nothing is subscribed.
//
// A tab out of sight holds no stream: each stream holds one of the six connections a browser opens
// to the dashboard, shared by all its tabs, and the calls of the tab in sight waited for a free one.
// Back in sight, the feed opens again as a reconnect does: the replay swaps in whole, so the feed
// on screen never blanks.

/** The live feed plus whether its channel is currently down (#948). */
export interface LiveEvents {
  events: RunEvent[]
  /** True while the stream is lost and being retried — the feed may be behind reality. */
  lost: boolean
  /** The message the agent is writing, as far as it has got; empty when it is writing none. Never in `events`. */
  writing: string
  /** What the daemon held of the run when the feed was opened has all come: what comes after is new. */
  replayed: boolean
}

/** Retry delays for a lost stream: quick first, then settle at a slow poll. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000]

function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] as number
}

/**
 * How long a reconnect waits for the server's end-of-replay marker before swapping anyway
 * (#1383). Every source sends `stream-sync` the moment its replay is delivered, so this
 * deadline fires only for a replay slower than it.
 */
const SYNC_GRACE_MS = 1500

/**
 * The key the feed a run last had on this page is remembered under: going back to a run shows its
 * chat at once, while its replay comes, as the chat it was and not its first prompt alone.
 */
function feedKey(projectId: string | null, agentId: string | null | undefined): string | null {
  return projectId && agentId ? `live-feed:${projectId}:${agentId}` : null
}

function lastFeed(key: string | null): RunEvent[] {
  return (key !== null && rememberedUnder<RunEvent[]>(key)) || []
}

export function useLiveEvents(projectId: string | null, agentId?: string | null): LiveEvents {
  const key = feedKey(projectId, agentId)
  // The events with the run they are of: the page swaps runs without a remount, and for the frame
  // before the effect below runs, one run's events must not show as the next one's.
  const [feed, setFeed] = useState<{ key: string | null; events: RunEvent[] }>(() => ({ key, events: lastFeed(key) }))
  const [lost, setLost] = useState(false)
  const [writing, setWriting] = useState('')
  const [replayedFor, setReplayedFor] = useState<string | null>(null)

  useEffect(() => {
    if (feed.key !== null && feed.events.length > 0) rememberUnder(feed.key, feed.events)
  }, [feed])

  // Another run, or one just started, is a feed of its own: it starts as that run's feed was last
  // seen here, or empty, and the live tail streams the run in as soon as its diary exists.
  useEffect(() => {
    const key = feedKey(projectId, agentId)
    const kept = lastFeed(key)
    const setEvents = (next: RunEvent[] | ((prev: RunEvent[]) => RunEvent[])) =>
      setFeed(prev => ({ key, events: typeof next === 'function' ? next(prev.events) : next }))
    setEvents(kept)
    setLost(false)
    setWriting('')
    setReplayedFor(null)
    if (!projectId || !agentId) return
    let channel: EventChannel | undefined
    let cancelled = false
    let attempt = 0
    // A run seen before has its last feed on screen: its replay is swapped in whole, as a reconnect's is.
    let first = kept.length === 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    // Out of sight, the feed is closed; each opening counts, so a stream that comes after the tab
    // went out of sight is closed at once, and its end retries nothing.
    let hidden = document.visibilityState === 'hidden'
    let opening = 0

    // A dead stream used to be silent: the daemon restarts, events just stop, and "the agent
    // went quiet" is indistinguishable from "the feed died" (#948). Now an errored close (or a
    // failed subscribe) flips `lost` and retries with backoff. A clean close is the server being
    // done with the channel on purpose (an unknown project) — not an outage —
    // so it neither retries nor alarms, matching the old behavior.
    const retry = () => {
      if (cancelled) return
      setLost(true)
      timer = setTimeout(subscribe, retryDelay(attempt++))
    }

    const subscribe = () => {
      // Every subscribe replays the whole log before following live. The FIRST one streams into
      // a pane this effect just cleared, so it renders as it arrives. A RECONNECT, or the first
      // subscribe to a run whose last feed is on screen, has a populated
      // feed on screen, and blanking it while history re-streamed was #1383's mid-run flicker:
      // the lost banner cleared on resubscribe, then the feed sat empty until the replay caught
      // up. So a reconnect buffers the replay and swaps atomically — on the server's stream-sync
      // marker, or at a grace deadline when the marker is slow. The feed never
      // shows less than it already showed (#1402's rule, applied to the live channel).
      const reconnect = !first
      first = false
      const mine = ++opening
      void onEvents(projectId, agentId).then(ch => {
        if (cancelled || mine !== opening) {
          void ch.close()
          return
        }
        channel = ch
        attempt = 0
        setLost(false)
        let buffer: RunEvent[] | undefined = reconnect ? [] : undefined
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
        ch.listen(event => {
          if (event.kind === 'stream-sync') {
            if (graceTimer) clearTimeout(graceTimer)
            swap()
            setReplayedFor(agentId)
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
          if (err && mine === opening) retry()
        })
      }, () => {
        if (mine === opening) retry()
      })
    }

    const close = () => {
      opening++
      if (timer) clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      void channel?.close()
      channel = undefined
    }
    const onVisibility = () => {
      const now = document.visibilityState === 'hidden'
      if (now === hidden) return
      hidden = now
      if (hidden) {
        close()
        // What it was writing is read again with the rest when the tab is back in sight.
        setWriting('')
      } else subscribe()
    }
    document.addEventListener('visibilitychange', onVisibility)

    if (!hidden) subscribe()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      close()
    }
    // agentId is a dependency: selecting another agent must resubscribe to that agent's log (#749).
  }, [projectId, agentId])

  // An agent's own tail (#749) holds nothing but that agent, so the feed is its whole log: also the
  // second `session` boundary a resumed session (#762) appends to the SAME journal, where slicing
  // at the last one hid everything before the resume for as long as the agent was live.
  const events = feed.key === key ? feed.events : lastFeed(key)
  return { events, lost, writing, replayed: replayedFor === agentId }
}

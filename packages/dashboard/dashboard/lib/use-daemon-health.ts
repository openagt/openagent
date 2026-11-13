import { createContext, useEffect, useState } from 'react'
import type * as impl from '../../src/dashboard-rpc/projects.js'
import { rpc } from './rpc.js'

/** How often the liveness probe asks, healthy or not. */
const PROBE_MS = 5000
/** A probe not answered by then counts as not answered: longer than the longest read that waits for a change (25 s), which the browser may queue the probe behind. */
const LONGER_THAN_A_WAITING_READ_MS = 30_000

// Is the daemon answering (#948)? A dead daemon is otherwise invisible: the live channel's
// transport retries silently without a channel-level verdict until a server answers, and the
// polled reads keep their last value on failure — so every surface just froze, indistinguishable
// from a quiet agent. One cheap read on a fixed cadence turns "unreachable" into a fact the
// shell can say out loud. Recovery needs no action here: the channels reconcile and the polls
// resume on their own once the daemon answers again. The first probe is one cadence after the page
// opened, which asks the daemon plenty on its own then; a tab not shown asks nothing.
export function useDaemonHealth(): Daemon {
  const [daemon, setDaemon] = useState<Daemon>('answering')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // The probe in flight, the one whose answer counts: one given up on is aborted, and its answer, late or not, changes nothing.
    let asking: AbortController | undefined
    const probe = () => {
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(probe, PROBE_MS)
        return
      }
      const ask = new AbortController()
      asking = ask
      const settle = (answered: Daemon) => {
        if (asking !== ask) return
        asking = undefined
        clearTimeout(timer)
        setDaemon(answered)
        timer = setTimeout(probe, PROBE_MS)
      }
      timer = setTimeout(() => {
        settle('silent')
        ask.abort()
      }, LONGER_THAN_A_WAITING_READ_MS)
      // Refused at once, by a computer that is online: nothing serves the page's address.
      rpc<typeof impl.onProjects>('onProjects', { signal: ask.signal })().then(
        () => settle('answering'),
        () => settle(navigator.onLine ? 'stopped' : 'silent'),
      )
    }
    timer = setTimeout(probe, PROBE_MS)
    return () => {
      if (timer) clearTimeout(timer)
      const left = asking
      asking = undefined
      left?.abort()
    }
  }, [])

  return daemon
}

/** OpenAgent answers; takes a probe and answers nothing in time; or refuses it, as a stopped one's address does. */
export type Daemon = 'answering' | 'silent' | 'stopped'

/** How an installed OpenAgent starts again, said the same wherever the page asks for a restart. */
export const INSTALLED_RESTARTS = 'an installed one restarts with the computer or with its installer\u2019s command'

/** OpenAgent is not answering ({@link useDaemonHealth}): what would ask it, Start, Send, Stop, an answer and a run's next step, is off until it does. */
export const DaemonDown = createContext(false)

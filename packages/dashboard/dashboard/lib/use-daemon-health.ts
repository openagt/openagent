import { useEffect, useState } from 'react'
import { onProjects } from '../rpc/projects.js'

/** How often the liveness probe asks, healthy or not. */
const PROBE_MS = 5000

// Is the daemon answering (#948)? A dead daemon is otherwise invisible: the live channel's
// transport retries silently without a channel-level verdict until a server answers, and the
// polled reads keep their last value on failure — so every surface just froze, indistinguishable
// from a quiet agent. One cheap read on a fixed cadence turns "unreachable" into a fact the
// shell can say out loud. Recovery needs no action here: the channels reconcile and the polls
// resume on their own once the daemon answers again. The first probe is one cadence after the page
// opened, which asks the daemon plenty on its own then; a tab not shown asks nothing.
export function useDaemonHealth(): boolean {
  const [healthy, setHealthy] = useState(true)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const probe = () => {
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(probe, PROBE_MS)
        return
      }
      onProjects().then(
        () => {
          if (cancelled) return
          setHealthy(true)
          timer = setTimeout(probe, PROBE_MS)
        },
        () => {
          if (cancelled) return
          setHealthy(false)
          timer = setTimeout(probe, PROBE_MS)
        },
      )
    }
    timer = setTimeout(probe, PROBE_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return healthy
}

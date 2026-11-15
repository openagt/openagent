import { useEffect, useState, useSyncExternalStore } from 'react'
import { sendStop } from '../rpc/control.js'

// One Stop per run, whichever control presses it (the message box's square and its Esc, the
// session's menu): pressed in one, each reads "Stopping…". A Stop the daemon says it signalled holds
// until the run is no longer live, so it cannot be fired again while its end is on the way: a second
// signal kills the agent. A Stop it refused holds nothing, and says why at the control pressed.

/** A Stop on its way to the daemon, or one it signalled. */
type Pressed = 'sent' | 'landed'

const pressed = new Map<string, Pressed>()
const listeners = new Set<() => void>()

function set(key: string, state: Pressed | undefined): void {
  if (state) pressed.set(key, state)
  else pressed.delete(key)
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The Stop of one run: whether it reads "Stopping…", why the last press here was refused, and the press. */
export function useStop(projectId: string, agentId: string | undefined, live: boolean): { stopping: boolean; error: string | null; stop: () => void } {
  const key = agentId ? `${projectId}\0${agentId}` : undefined
  const state = useSyncExternalStore(subscribe, () => (key ? pressed.get(key) : undefined), () => undefined)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [key])
  // Released once the run is no longer live: a message continues the same run (#762), which is to be stoppable again.
  useEffect(() => {
    if (key && !live && state === 'landed') set(key, undefined)
  }, [key, live, state])
  const stop = (): void => {
    if (!key || pressed.has(key)) return
    set(key, 'sent')
    setError(null)
    sendStop(projectId, agentId)
      .then(result => {
        set(key, result.ok ? 'landed' : undefined)
        if (!result.ok) setError(result.error)
      })
      .catch((err: unknown) => {
        set(key, undefined)
        setError(err instanceof Error ? err.message : 'Could not stop the agent.')
      })
  }
  return { stopping: state === 'sent' || (state === 'landed' && live), error, stop }
}

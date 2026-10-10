import { useMemo } from 'react'
import type { Machine } from './machines.js'
import { usePolled } from './use-async.js'
import { onMachinesReachable } from '../rpc/machines.js'

// The saved machines' online/offline status (#1072). The daemon holds each machine's key, so it
// makes the call and this polls its answer on a short interval. Display-only, so nothing binds a
// control to the poll value: the status dots just read the map.

/** A saved machine's reachability, or absent while the first check is still out (reads as "unknown"). */
export type MachineStatus = 'online' | 'offline'

/** How often to re-check the saved machines. Cheap: one 3s-capped ping each, no agent involved. */
const POLL_MS = 10_000

/**
 * Poll each saved machine's reachability and return an id -> status map. An id missing from the
 * map means the first check has not come back yet (draw it neutral, not offline). Prerender has
 * no daemon, so it starts empty and fills on the client.
 */
export function useMachineStatus(machines: Machine[]): Record<string, MachineStatus> {
  // Poll again at once when the list changes, not on every render (the list is a fresh array).
  const key = machines.map(machine => machine.id).join('|')
  const load = useMemo(
    () => (key ? () => onMachinesReachable() : null),
    [key],
  )
  const reachable = usePolled<Record<string, boolean>>(load, {}, POLL_MS, [key]).value
  return useMemo(() => {
    const out: Record<string, MachineStatus> = {}
    for (const [id, ok] of Object.entries(reachable)) out[id] = ok ? 'online' : 'offline'
    return out
  }, [reachable])
}

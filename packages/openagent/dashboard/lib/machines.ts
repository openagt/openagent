import { useEffect, useSyncExternalStore } from 'react'
import { onMachines, sendAddMachine, sendRemoveMachine, type AddMachineResult, type Machine } from '../rpc/machines.js'

// The saved machines: the other computers running OpenAgent that a run can be sent to. The list
// is the daemon's, kept in the person's home file, so every browser on this computer shows the
// same one, and it is read again when the window is looked at again. A machine's key never
// reaches the browser: the daemon holds it and makes the calls.

export type { Machine }

const EMPTY: Machine[] = []
let cache: Machine[] | null = null
/** Counts the reads sent, so an answer that a later read has overtaken is dropped. */
let reads = 0
/** The reads still out, so a page that mounts meanwhile does not send another. */
let reading = 0
let watching = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Read the list from the daemon again. A read that fails keeps what is shown. */
export function refreshMachines(): Promise<void> {
  const read = ++reads
  reading++
  return onMachines()
    .then(
      machines => {
        if (read !== reads) return
        cache = machines
        for (const listener of listeners) listener()
      },
      () => {},
    )
    .finally(() => reading--)
}

function ensureLoaded(): void {
  // Not read yet, or the read failed: the next page that needs the list asks again.
  if (cache === null && reading === 0) void refreshMachines()
  if (watching || typeof window === 'undefined') return
  watching = true
  // Another browser on this computer may have saved or removed a machine since.
  window.addEventListener('focus', () => void refreshMachines())
}

/** Save the machine a pasted address names; the list is read again once the daemon has it. */
export async function addMachine(pasted: string, label?: string): Promise<AddMachineResult> {
  const result = await sendAddMachine(pasted, label)
  if (result.ok) await refreshMachines()
  return result
}

/**
 * Take a saved machine off the list, and answer whether the daemon did. The list is read again
 * either way, so a machine the daemon could not remove is still shown.
 */
export async function removeMachine(id: string): Promise<boolean> {
  const removed = await sendRemoveMachine(id).then(() => true, () => false)
  await refreshMachines()
  return removed
}

/** The saved machines as reactive state: empty until the daemon has answered. */
export function useMachines(): Machine[] {
  const machines = useSyncExternalStore(subscribe, () => cache ?? EMPTY, () => EMPTY)
  useEffect(ensureLoaded, [])
  return machines
}

/** Whether the daemon has answered with the list: until then "none saved" is not known. */
export function useMachinesLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => cache !== null, () => false)
}

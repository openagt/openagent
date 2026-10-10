import { useSyncExternalStore } from 'react'

// The saved machine picked as where the next run starts (#1067). In memory only: it is a pick for
// the runs started from this page, not a saved preference, so a reload goes back to this machine.
// Null means this machine: the run starts here, through this project's own start hook. The value
// is the machine's id.

let selectedMachineId: string | null = null
const listeners = new Set<() => void>()

/** Pick a saved machine (by id) as the run's target, or null to go back to this machine. */
export function selectMachine(id: string | null): void {
  if (selectedMachineId === id) return
  selectedMachineId = id
  for (const listener of listeners) listener()
}

/** The picked machine's id, read at submit time to say where the run starts. */
export function getSelectedMachineId(): string | null {
  return selectedMachineId
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The picked machine's id as reactive state; null on the server and until one is picked. */
export function useSelectedMachineId(): string | null {
  return useSyncExternalStore(subscribe, getSelectedMachineId, () => null)
}

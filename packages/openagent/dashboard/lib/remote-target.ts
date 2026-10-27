import { useSyncExternalStore } from 'react'

// The saved machine picked as where the next run starts (#1067). In memory only: it is a pick for
// the runs started from this page, not a saved preference, so a reload goes back to this machine.
// Null means this machine: the run starts here, through this project's own start hook. The value
// is the machine's id.

let selectedMachineId: string | null = null
const listeners = new Set<() => void>()
// On a project only another computer of the person's has (its `home`, elsewhere.ts), that computer
// is picked each time the project is opened, whatever was picked before: a run of it goes there
// unless the person picks otherwise on its page. A pick made so is let go again on a project of
// this computer's, where this computer is the default.
let pickedForHome = false

/** Pick a saved machine (by id) as the run's target, or null to go back to this machine. */
export function selectMachine(id: string | null): void {
  // The person's own pick, or the project's: a project's is marked again by its caller.
  pickedForHome = false
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

/** Pick the computer a project is on, when it is another's, or let go of such a pick on one of this computer's. Called as a project is opened. */
export function followProjectHome(home: string | undefined): void {
  if (home !== undefined) {
    selectMachine(home)
    pickedForHome = true
  } else if (pickedForHome) {
    selectMachine(null)
  }
}

/**
 * The machine a run of the project goes to: the one picked, where the project can go there. A
 * project with no repository address has no name another machine knows it by: one of this
 * computer's runs here only, and another computer's on that computer only. Until the launcher is
 * read that is not known, and the pick holds.
 */
export function runTarget<M extends { id: string }>(machines: readonly M[], selected: string | null, launcher: { address?: string } | null, home: string | undefined): M | undefined {
  if (selected === null) return undefined
  if (launcher !== null && launcher.address === undefined && selected !== home) return undefined
  return machines.find(machine => machine.id === selected)
}

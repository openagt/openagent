import { useSyncExternalStore } from 'react'
import { updatePreferences } from './preferences.js'

// The saved machine picked as where the next run starts (#1067). The person's pick is saved
// (`runOn` in the preferences), as the model and the effort are, and the page picks it again at its
// next opening: a machine no longer saved, or offline when the page opens, is not picked, and the
// page says so. Null means this machine: the run starts here, through this project's own start
// hook. The value is the machine's id.

let selectedMachineId: string | null = null
const listeners = new Set<() => void>()
// On a project only another computer of the person's has (its `home`, elsewhere.ts), that computer
// is picked each time the project is opened, whatever was picked before: a run of it goes there
// unless the person picks otherwise on its page. A pick made so is let go again on a project of
// this computer's, back to the person's own pick.
let pickedForHome = false
/** The person's own pick: what a project of this computer's goes back to. */
let personsPick: string | null = null
/** Where the saved pick stands as the page opens: not read yet, picked and waiting for its machine's first check, or settled. */
let restoring: 'unread' | 'checking' | 'settled' = 'unread'
let fallback: RunOnFallback | null = null

/** Why the saved pick was let go as the page opened, and the run starts on this machine instead. */
export type RunOnFallback = { why: 'gone' } | { why: 'offline'; id: string }

function notify(): void {
  for (const listener of listeners) listener()
}

function set(id: string | null): void {
  if (selectedMachineId === id) return
  selectedMachineId = id
  notify()
}

/** The person picks a saved machine (by id) as the run's target, or null to go back to this machine. Saved, for the next opening. */
export function selectMachine(id: string | null): void {
  // The person's own pick, or the project's: a project's is marked again by its caller.
  pickedForHome = false
  personsPick = id
  restoring = 'settled'
  if (fallback !== null) {
    fallback = null
    notify()
  }
  set(id)
  updatePreferences({ runOn: id ?? '' })
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

/** Why the saved pick was let go as the page opened, until the person picks; null when it was not. */
export function useRunOnFallback(): RunOnFallback | null {
  return useSyncExternalStore(subscribe, () => fallback, () => null)
}

/**
 * Pick the saved machine again as the page opens, once the preferences and the machines are read:
 * at once, so a run started meanwhile goes where the person said. One no longer saved is let go,
 * and so is the pick of it. One its first check finds offline is let go for this opening only: the
 * pick stays saved, for an opening when it is on. A machine that goes offline later is the person's
 * to see, as one picked by hand is (#1073). Called with each new reading; does nothing once settled.
 */
export function restoreRunOn(saved: string | undefined, machines: readonly { id: string }[] | null, status: Readonly<Record<string, 'online' | 'offline'>>): void {
  if (restoring === 'unread') {
    if (machines === null) return
    if (saved === undefined) {
      restoring = 'settled'
      return
    }
    if (!machines.some(machine => machine.id === saved)) {
      restoring = 'settled'
      fallback = { why: 'gone' }
      updatePreferences({ runOn: '' })
      notify()
      return
    }
    restoring = 'checking'
    personsPick = saved
    if (!pickedForHome) set(saved)
  }
  if (restoring !== 'checking' || saved === undefined || status[saved] === undefined) return
  restoring = 'settled'
  if (status[saved] === 'online') return
  personsPick = null
  fallback = { why: 'offline', id: saved }
  if (!pickedForHome) set(null)
  notify()
}

/** Pick the computer a project is on, when it is another's, or let go of such a pick on one of this computer's. Called as a project is opened. */
export function followProjectHome(home: string | undefined): void {
  if (home !== undefined) {
    set(home)
    pickedForHome = true
  } else if (pickedForHome) {
    pickedForHome = false
    set(personsPick)
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

/** Forget what this page restored, for a test: the next {@link restoreRunOn} reads the saved pick again. */
export function resetRunOnForTest(): void {
  selectedMachineId = null
  pickedForHome = false
  personsPick = null
  restoring = 'unread'
  fallback = null
  notify()
}

import { useEffect, useSyncExternalStore } from 'react'
import { onMachines, sendAddComputerThrough, sendAddMachine, sendMachineTold, sendRemoveMachine, sendRenameComputer, sendRenameMachine, type AddMachineResult, type Machine, type RemoveMachineResult } from '../rpc/machines.js'
import { getSelectedMachineId, selectMachine } from './remote-target.js'

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

/** Save the machine a pasted link names; the list is read again once the daemon has it. */
export async function addMachine(pasted: string, label?: string): Promise<AddMachineResult> {
  const result = await sendAddMachine(pasted, label)
  if (result.ok) await refreshMachines()
  return result
}

/** Give a saved machine the name the person picked; the list is read again once the daemon has it, so "Run on" says it too. */
export async function renameMachine(id: string, label: string): Promise<AddMachineResult> {
  const result = await sendRenameMachine(id, label)
  if (result.ok) await refreshMachines()
  return result
}

/** Give this computer the name the person picked; the list is read again, so every place this page names it says it. */
export async function renameComputer(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await sendRenameComputer(name)
  if (result.ok) await refreshMachines()
  return result.ok ? { ok: true } : result
}

/** Save a computer that keeps a line open to a saved server, reached through it; the list is read again once the daemon has it. */
export async function addComputerThrough(machineId: string, computerId: string): Promise<AddMachineResult> {
  const result = await sendAddComputerThrough(machineId, computerId)
  if (result.ok) await refreshMachines()
  return result
}

/** Say the person was told their logins are copied to another person's computer; the list is read again once the daemon has it. */
export async function tellMachine(id: string): Promise<void> {
  await sendMachineTold(id).catch(() => {})
  await refreshMachines()
}

/**
 * Take a saved machine off the list, and answer whether the daemon did, with its reason when it
 * did not. The list is read again either way, so a machine the daemon did not remove is still shown.
 * A removed machine is no longer where the next run starts (#1072): that run would point at
 * something that is not in the list.
 */
export async function removeMachine(id: string): Promise<RemoveMachineResult> {
  const result = await sendRemoveMachine(id).catch((): RemoveMachineResult => ({ ok: false, error: 'The machine could not be removed.' }))
  await refreshMachines()
  // The machine, or a computer saved through it, which went with it.
  const selected = getSelectedMachineId()
  if (result.ok && selected !== null && !(cache ?? []).some(machine => machine.id === selected)) selectMachine(null)
  return result
}

/** Whether the daemon has answered the list yet: an empty list is then no machines, not one unread. */
export function useMachinesRead(): boolean {
  const read = useSyncExternalStore(subscribe, () => cache !== null, () => false)
  useEffect(ensureLoaded, [])
  return read
}

/** The saved machines as reactive state: empty until the daemon has answered. */
export function useMachines(): Machine[] {
  const machines = useSyncExternalStore(subscribe, () => cache ?? EMPTY, () => EMPTY)
  useEffect(ensureLoaded, [])
  return machines
}

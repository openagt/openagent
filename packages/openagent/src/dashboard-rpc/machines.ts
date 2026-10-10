import { pingRemote } from '../dashboard/remote-run.js'
import { addMachine, listMachines, removeMachine } from '../registry.js'
import { parseMachineUrl } from '../machine-url.js'

// The saved machines, for the dashboard: the other computers a run can be sent to. The list is
// the daemon's, in the person's home file, so every browser on this computer shows the same
// machines. A machine's key is never part of an answer: the daemon holds it and makes the calls.

/** A saved machine as the browser sees it: no key. */
export interface Machine {
  id: string
  label: string
  url: string
}

export type AddMachineResult = { ok: true; machine: Machine } | { ok: false; error: string }

/** The saved machines, newest first. */
export async function onMachines(): Promise<Machine[]> {
  return (await listMachines()).map(({ id, label, url }) => ({ id, label, url }))
}

/**
 * Save the machine a pasted line names: the address another OpenAgent prints when it is opened
 * to the network, which carries its key. Saving an address again replaces its name and key.
 */
export async function sendAddMachine(pasted: string, label?: string): Promise<AddMachineResult> {
  const parsed = typeof pasted === 'string' ? parseMachineUrl(pasted) : null
  if (!parsed) return { ok: false, error: 'That is not a web address.' }
  if (!parsed.token) return { ok: false, error: 'This address has no token, so the machine would refuse every call.' }
  const { id, url, label: saved } = await addMachine({ ...parsed, ...(typeof label === 'string' ? { label } : {}) })
  return { ok: true, machine: { id, label: saved, url } }
}

/** Take a saved machine off the list. */
export async function sendRemoveMachine(id: string): Promise<void> {
  await removeMachine(id)
}

/** Whether each saved machine answers right now, by id: one short call to each, with its key. */
export async function onMachinesReachable(): Promise<Record<string, boolean>> {
  const machines = await listMachines()
  const entries = await Promise.all(machines.map(async machine => [machine.id, await pingRemote(machine)] as const))
  return Object.fromEntries(entries)
}

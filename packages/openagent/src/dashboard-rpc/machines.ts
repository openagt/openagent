import { hostname } from 'node:os'
import { enterRemote, leaveRemote, pingRemote } from '../dashboard/remote-run.js'
import { errorMessage } from '../error-message.js'
import { contextRemote } from './context.js'
import { addMachine, listMachines, removeMachine } from '../registry.js'
import { parseMachineLink } from '../machine-link.js'

// The saved machines, for the dashboard: the other computers a run can be sent to. The list is
// the daemon's, in the person's home file, so every browser on this computer shows the same
// machines. This computer's key on a machine is never part of an answer: the daemon holds it and
// makes the calls.

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

/** This computer's name as the other machine lists it, among the devices that are in there. */
function ownName(): string {
  return hostname().replace(/\.local$/i, '') || 'another computer'
}

/**
 * Save the machine a pasted link names: the link another OpenAgent gives for a new device. This
 * computer is let in there with the link's code, once, and keeps the key it is answered. Adding
 * a machine again, with a new link, replaces its name and the key, and the key it had there
 * before is taken out.
 */
export async function sendAddMachine(pasted: string, label?: string): Promise<AddMachineResult> {
  const link = typeof pasted === 'string' ? parseMachineLink(pasted) : null
  if (!link) return { ok: false, error: 'That is not a link another OpenAgent gives: on the other machine, open Settings, find Devices, and press Add device.' }
  // Asked before the link is spent: the key a run at work is read with is not replaced under it.
  const saved = (await listMachines()).find(machine => machine.id === link.url)
  if (saved && contextRemote().working(saved.url)) return { ok: false, error: `An agent is working on ${saved.label}. Stop it, or wait until it ends, then add the machine again.` }
  const entered = await enterRemote(link.door, link.code, ownName(), link.pin)
  if (!entered.ok) return entered
  const access = { url: link.url, key: entered.key, door: link.door, ...(link.pin ? { pin: link.pin } : {}) }
  let added: Awaited<ReturnType<typeof addMachine>>
  try {
    added = await addMachine({ ...access, ...(typeof label === 'string' ? { label } : {}) })
  } catch (err) {
    // A key nobody holds is not left on the machine.
    void leaveRemote(access)
    return { ok: false, error: `The machine could not be saved: ${errorMessage(err)}` }
  }
  // The runs that ended there before go on being read, with the new key; the old keys are of no use any more.
  contextRemote().rekey(link.url, entered.key, link.pin)
  for (const old of added.displaced) void leaveRemote(old)
  const { id, url, label: name } = added.record
  return { ok: true, machine: { id, label: name, url } }
}

export type RemoveMachineResult = { ok: true } | { ok: false; error: string }

/**
 * Take a saved machine off the list, and this computer out of the machine: its key there stops
 * working. Not while a run is at work there, which is read with that key. Taking the key out is
 * not waited for: a machine that cannot be reached right now keeps it until this computer is
 * removed there, among its devices.
 */
export async function sendRemoveMachine(id: string): Promise<RemoveMachineResult> {
  const saved = (await listMachines()).find(machine => machine.id === id)
  if (saved && contextRemote().working(saved.url)) return { ok: false, error: `An agent is working on ${saved.label}. Stop it, or wait until it ends, then remove the machine.` }
  const removed = await removeMachine(id)
  if (removed) void leaveRemote(removed)
  return { ok: true }
}

/** Whether each saved machine answers right now, by id: one short call to each, with this computer's key. */
export async function onMachinesReachable(): Promise<Record<string, boolean>> {
  const machines = await listMachines()
  const entries = await Promise.all(machines.map(async machine => [machine.id, await pingRemote(machine)] as const))
  return Object.fromEntries(entries)
}

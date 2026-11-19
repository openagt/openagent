import { THROUGH_PATH, enterRemote, leaveRemote, remoteComputers, remoteDoor } from '../dashboard/remote-run.js'
import { errorMessage } from '../error-message.js'
import { contextRemote } from './context.js'
import { addMachine, isPersonName, listMachines, thisComputerName, useLoginsOn, type MachineRecord } from '../registry.js'
import { parseMachineLink } from '../machine-link.js'
import type { AddMachineResult, Machine } from './machines.js'

// Saving a machine, for the person's own press (machines.ts) and for their other computers, which
// keep the same machines saved (computers.ts, computers-sync.ts). Not an RPC module: what it
// exports is no call a page makes.

/** A saved machine as the browser is handed it. */
export function shown({ id, label, url, owner, told, server }: MachineRecord): Machine {
  return { id, label, url, ...(owner !== undefined ? { owner } : {}), ...(told ? { told } : {}), ...(server ? { server } : {}) }
}

/** The machines saved through a server: computers at home it keeps a line to, reached at its address with this computer's key there. */
export function throughOf(server: Pick<MachineRecord, 'url'>, saved: readonly MachineRecord[]): MachineRecord[] {
  return saved.filter(machine => machine.url.startsWith(`${server.url}${THROUGH_PATH}`))
}

/** This computer's name as the other machine lists it, among the devices that are in there. */
export async function ownName(): Promise<string> {
  return (await thisComputerName()) || 'another computer'
}

/** Get in at the machine a link names and save it, with this computer's own key there. */
export async function saveMachine(pasted: string, label?: string, owner?: string): Promise<AddMachineResult> {
  const link = typeof pasted === 'string' ? parseMachineLink(pasted) : null
  if (!link) return { ok: false, error: 'That is not a link another OpenAgent gives: on the other machine, open Settings, find Devices, and press Add device.' }
  // Asked before the link is spent: the key a run at work is read with is not replaced under it.
  const saved = (await listMachines()).find(machine => machine.id === link.url)
  if (saved && contextRemote().working(saved.url)) return { ok: false, error: `An agent is working on ${saved.label}. Stop it, or wait until it ends, then add the machine again.` }
  const entered = await enterRemote(link.door, link.code, await ownName(), link.pin)
  if (!entered.ok) return entered
  const access = { url: link.url, key: entered.key, door: link.door, ...(link.pin ? { pin: link.pin } : {}) }
  // Whose computer it is: its door says whether this computer's person is its owner. Another
  // person's is saved as theirs, so nothing of this computer's (its keys, its logins) is handed to it.
  let whose = isPersonName(owner) ? owner : undefined
  if (whose === undefined) {
    const me = await remoteDoor(access, { what: 'me' })
    const said = me.ok && me.said && typeof me.said === 'object' ? (me.said as { owner?: unknown; ownerName?: unknown }) : undefined
    if (said?.owner === false && isPersonName(said.ownerName)) whose = said.ownerName
  }
  let added: Awaited<ReturnType<typeof addMachine>>
  try {
    added = await addMachine({ ...access, ...(typeof label === 'string' ? { label } : {}), ...(whose !== undefined ? { owner: whose } : {}) })
  } catch (err) {
    // A key nobody holds is not left on the machine.
    void leaveRemote(access)
    return { ok: false, error: `The machine could not be saved: ${errorMessage(err)}` }
  }
  // The runs that ended there before go on being read, with the new key; the old keys are of no use any more.
  contextRemote().rekey(link.url, entered.key, link.pin)
  // The computers saved through this server are reached with its key: they take the new one too.
  for (const through of throughOf(added.record, await listMachines())) {
    await addMachine({ url: through.url, key: entered.key, door: through.door, label: through.label, ...(link.pin ? { pin: link.pin } : {}) })
    contextRemote().rekey(through.url, entered.key, link.pin)
  }
  for (const old of added.displaced) void leaveRemote(old)
  return { ok: true, machine: shown(added.record) }
}

/** Save a computer on a line at a saved server, through that server. */
export async function saveComputerThrough(machineId: string, computerId: string): Promise<AddMachineResult> {
  const server = (await listMachines()).find(machine => machine.id === machineId)
  if (!server || server.url.includes(THROUGH_PATH)) return { ok: false, error: 'That server is no longer saved.' }
  const asked = await remoteComputers(server)
  if (!asked.ok) return { ok: false, error: `${server.label} could not be asked for its computers: ${asked.error}` }
  const computer = asked.computers.find(candidate => candidate.id === computerId)
  if (!computer) return { ok: false, error: `${server.label} has no such computer on a line now.` }
  const url = `${server.url}${THROUGH_PATH}${computer.id}`
  const before = (await listMachines()).find(machine => machine.id === url)
  const { record } = await addMachine({ url, key: server.key, door: `${url}/_devices/enter`, label: `${computer.name} (through ${server.label})`, ...(server.pin ? { pin: server.pin } : {}), ...(computer.owner !== undefined ? { owner: computer.owner } : {}) })
  if (before?.logins) await useLoginsOn(record.id, true)
  return { ok: true, machine: shown(record) }
}

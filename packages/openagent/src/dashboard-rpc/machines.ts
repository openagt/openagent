import { hostname } from 'node:os'
import { basename } from 'node:path'
import { readSharing } from '@openagt/agent-data'
import { THROUGH_PATH, deviceIdOf, enterRemote, giveRemoteLogins, leaveRemote, pingRemote, remoteAddMachine, remoteComputers, remoteDoor, remoteFacts, remoteLogins, remoteProject } from '../dashboard/remote-run.js'
import { isLoginWord, type MachineLogins } from '../dashboard/machine-logins.js'
import { errorMessage } from '../error-message.js'
import { repositoryAddress, repositorySpelling } from '../repository-address.js'
import { contextRemote, resolveProjectPath } from './context.js'
import { addMachine, isAccount, listMachines, noteListed, removeMachine, renameMachine, tellMachine, type MachineRecord } from '../registry.js'
import { parseMachineLink } from '../machine-link.js'
import { openagentVersion } from '../version.js'

// The saved machines, for the dashboard: the other computers a run can be sent to. The list is
// the daemon's, in the person's home file, so every browser on this computer shows the same
// machines. This computer's key on a machine is never part of an answer: the daemon holds it and
// makes the calls.

/** A saved machine as the browser sees it: no key. */
export interface Machine {
  id: string
  label: string
  url: string
  /** Whose computer it is, when it is another person's: a run there uses this person's own logins, copied there. */
  owner?: string
  /** The person was told so, once. */
  told?: true
}

/** A saved machine as the browser is handed it. */
function shown({ id, label, url, owner, told }: MachineRecord): Machine {
  return { id, label, url, ...(owner !== undefined ? { owner } : {}), ...(told ? { told } : {}) }
}

export type AddMachineResult = { ok: true; machine: Machine } | { ok: false; error: string }

/** The saved machines, newest first. */
export async function onMachines(): Promise<Machine[]> {
  return (await listMachines()).map(shown)
}

/** The machines saved through a server: computers at home it keeps a line to, reached at its address with this computer's key there. */
function throughOf(server: Pick<MachineRecord, 'url'>, saved: readonly MachineRecord[]): MachineRecord[] {
  return saved.filter(machine => machine.url.startsWith(`${server.url}${THROUGH_PATH}`))
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
 *
 * `owner` is said for a computer of another person's that keeps a line to this server for
 * everyone: the door says whose it is when it tells this OpenAgent of it.
 */
export async function sendAddMachine(pasted: string, label?: string, owner?: string): Promise<AddMachineResult> {
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
    added = await addMachine({ ...access, ...(typeof label === 'string' ? { label } : {}), ...(isAccount(owner) ? { owner } : {}) })
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
  // The computers saved through it go with it: they are reached with its key, which is taken out there.
  const through = saved ? throughOf(saved, await listMachines()) : []
  const busy = through.find(machine => contextRemote().working(machine.url))
  if (busy) return { ok: false, error: `An agent is working on ${busy.label}, through ${saved!.label}. Stop it, or wait until it ends, then remove the machine.` }
  for (const machine of through) await removeMachine(machine.id)
  const removed = await removeMachine(id)
  if (removed) void leaveRemote(removed)
  return { ok: true }
}

/** A computer that keeps a line open to a saved server, and whether it is saved here, through that server. */
export interface ComputerThrough {
  id: string
  name: string
  online: boolean
  added: boolean
  /** Whose computer it is, when it is another person's that keeps its line there for everyone. */
  owner?: string
}

export type ComputersThrough = { ok: true; computers: ComputerThrough[] } | { ok: false; error: string }

/**
 * The computers that keep a line open to a saved server: computers at home that a run can be
 * sent to through the server, from here, as the server's own page does. None for a machine that
 * is no server, and for one saved through a server.
 */
export async function onComputersThrough(machineId: string): Promise<ComputersThrough> {
  const saved = await listMachines()
  const server = saved.find(machine => machine.id === machineId)
  if (!server) return { ok: false, error: 'That machine is no longer saved.' }
  if (server.url.includes(THROUGH_PATH)) return { ok: true, computers: [] }
  const asked = await remoteComputers(server)
  if (!asked.ok) return asked
  const through = new Set(throughOf(server, saved).map(machine => machine.url))
  return { ok: true, computers: asked.computers.map(computer => ({ ...computer, added: through.has(`${server.url}${THROUGH_PATH}${computer.id}`) })) }
}

/**
 * Save a computer that keeps a line open to a saved server, as a machine of its own: reached
 * through the server, with this computer's key there. Nothing is entered anywhere: the server
 * already lets this computer in, and passes its calls down the computer's line.
 */
export async function sendAddComputerThrough(machineId: string, computerId: string): Promise<AddMachineResult> {
  const server = (await listMachines()).find(machine => machine.id === machineId)
  if (!server || server.url.includes(THROUGH_PATH)) return { ok: false, error: 'That server is no longer saved.' }
  const asked = await remoteComputers(server)
  if (!asked.ok) return { ok: false, error: `${server.label} could not be asked for its computers: ${asked.error}` }
  const computer = asked.computers.find(candidate => candidate.id === computerId)
  if (!computer) return { ok: false, error: `${server.label} has no such computer on a line now.` }
  const url = `${server.url}${THROUGH_PATH}${computer.id}`
  const { record } = await addMachine({ url, key: server.key, door: `${url}/_devices/enter`, label: `${computer.name} (through ${server.label})`, ...(server.pin ? { pin: server.pin } : {}), ...(computer.owner !== undefined ? { owner: computer.owner } : {}) })
  return { ok: true, machine: shown(record) }
}

/** Write down that the person was told their logins are copied to a saved machine of another person's: the page says it once. */
export async function sendMachineTold(machineId: string): Promise<{ ok: boolean }> {
  return { ok: typeof machineId === 'string' && (await tellMachine(machineId)) }
}

export type MachineLoginsResult = { ok: true; logins: MachineLogins } | { ok: false; error: string }

/**
 * This person's logins on a saved machine of another person's, as that machine says: copied from
 * a server, or made there. Read through the server when the machine is reached through one.
 */
export async function onMachineLogins(machineId: string): Promise<MachineLoginsResult> {
  const machine = (await listMachines()).find(saved => saved.id === machineId)
  if (!machine) return { ok: false, error: 'That machine is no longer saved.' }
  if (machine.owner === undefined) return { ok: false, error: 'That machine is no other person\'s computer.' }
  return remoteLogins(machine)
}

/**
 * Hand this person's own logins to a saved machine of another person's: the person made them for
 * it, here, so they are no copies, and no server's copy takes their place later.
 */
export async function sendMachineLogins(machineId: string, given: { github?: unknown; claude?: unknown }): Promise<MachineLoginsResult> {
  const machine = (await listMachines()).find(saved => saved.id === machineId)
  if (!machine) return { ok: false, error: 'That machine is no longer saved.' }
  if (machine.owner === undefined) return { ok: false, error: 'That machine is no other person\'s computer.' }
  const { github, claude } = given && typeof given === 'object' ? given : {}
  if ((github !== undefined && !isLoginWord(github)) || (claude !== undefined && !isLoginWord(claude)) || (github === undefined && claude === undefined)) return { ok: false, error: 'That is no login.' }
  return giveRemoteLogins(machine, { ...(github !== undefined ? { github } : {}), ...(claude !== undefined ? { claude } : {}) })
}

/**
 * What a saved machine's door says of the person this computer is in as there: their GitHub
 * account, whether they are that computer's owner, and their devices, as the door lists them. A
 * computer several people use answers it; `unknown` is a machine that does not say (one from
 * before persons, or reached through a server). What it said is another computer's data: the page
 * reads it as such.
 */
export type MachinePerson = { ok: true; said: unknown } | { ok: false; error: string; unknown?: true }

export async function onMachinePerson(machineId: string): Promise<MachinePerson> {
  const machine = (await listMachines()).find(saved => saved.id === machineId)
  if (!machine) return { ok: false, error: 'That machine is no longer saved.' }
  if (machine.url.includes(THROUGH_PATH)) return { ok: false, error: 'A computer reached through a server says nothing of persons.', unknown: true }
  return remoteDoor(machine, { what: 'me' })
}

/** Take one of this person's devices out at a saved machine, by its id there; answers what {@link onMachinePerson} does, as it is after. */
export async function sendRemoveMachineDevice(machineId: string, deviceId: string): Promise<MachinePerson> {
  const machine = (await listMachines()).find(saved => saved.id === machineId)
  if (!machine || machine.url.includes(THROUGH_PATH)) return { ok: false, error: 'That machine is no longer saved.' }
  if (typeof deviceId !== 'string' || !/^[a-z0-9]{6,32}$/.test(deviceId)) return { ok: false, error: 'That is no device id.' }
  return remoteDoor(machine, { what: 'remove', id: deviceId })
}

/**
 * A link that lets this computer's line in at a saved machine, as this person's: what keeping a
 * line open to a computer several people use starts from, for a person who cannot ask for one
 * over SSH. The link works once, and only for a line.
 */
export async function sendMachineLineLink(machineId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const machine = (await listMachines()).find(saved => saved.id === machineId)
  if (!machine || machine.url.includes(THROUGH_PATH)) return { ok: false, error: 'That machine is no longer saved.' }
  const asked = await remoteDoor(machine, { what: 'line' })
  if (!asked.ok) return asked
  const url = (asked.said as { url?: unknown } | null)?.url
  return typeof url === 'string' && url.startsWith('https://') ? { ok: true, url } : { ok: false, error: 'The machine gave no link.' }
}

/** Whether each saved machine answers right now, by id: one short call to each, with this computer's key. */
export async function onMachinesReachable(): Promise<Record<string, boolean>> {
  const machines = await listMachines()
  const entries = await Promise.all(machines.map(async machine => [machine.id, await pingRemote(machine)] as const))
  return Object.fromEntries(entries)
}

/** This computer's OpenAgent, and the one each saved machine runs. */
export interface MachineVersions {
  /** This computer's own. */
  version: string
  /** This computer's own name, as another machine lists it. */
  name: string
  /**
   * Each saved machine, with its version when it answers and says, the id it lists this computer
   * under among its devices, and the ids it is listed under at the doors of the machines it saved.
   */
  machines: (Machine & { version?: string; device?: string; listed?: string[] })[]
}

/**
 * The saved machines with the OpenAgent each runs, beside this computer's own: how a page tells
 * that a machine fell behind this computer. One short call to each, with this computer's key.
 * The key itself is never told: only the id the machine lists this computer under, which a page
 * that lists the machine's devices names this computer by. A machine also says the ids it is
 * listed under at the doors it saved: one of them in this computer's own door is that machine,
 * in there too, so a page lists the computer once. A machine that does not answer is known by
 * what it said last.
 */
export async function onMachineVersions(): Promise<MachineVersions> {
  const machines = await Promise.all(
    (await listMachines()).map(async machine => {
      const { version, listed: said } = await remoteFacts(machine)
      // What it says now is kept; one that does not answer is known by what it said last.
      if (version !== undefined) await noteListed(machine, said ?? []).catch(() => {})
      const listed = version !== undefined ? said : machine.listed
      const device = deviceIdOf(machine.key)
      return { ...shown(machine), ...(version !== undefined ? { version } : {}), ...(device !== undefined ? { device } : {}), ...(listed !== undefined ? { listed } : {}) }
    }),
  )
  return { version: openagentVersion(), name: ownName(), machines }
}

/** Give a saved machine the name the person picked. */
export async function sendRenameMachine(id: string, label: string): Promise<AddMachineResult> {
  if (typeof id !== 'string' || typeof label !== 'string' || !label.trim()) return { ok: false, error: 'Give it a name.' }
  const renamed = await renameMachine(id, label)
  return renamed ? { ok: true, machine: shown(renamed) } : { ok: false, error: 'That machine is no longer saved.' }
}

/**
 * Have a saved machine save this computer, with a link this computer's door gave for a new
 * device: from then on it starts runs here too. Not for a computer reached through a server,
 * whose runs come here through that server.
 */
export async function sendLetMachineIn(machineId: string, link: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof link !== 'string' || !parseMachineLink(link)) return { ok: false, error: 'That is no link of this computer\'s door.' }
  const machine = (await listMachines()).find(saved => saved.id === machineId)
  if (!machine) return { ok: false, error: 'That machine is no longer saved.' }
  if (machine.url.includes(THROUGH_PATH)) return { ok: false, error: `${machine.label} is reached through a server: its runs come here through that server.` }
  const added = await remoteAddMachine(machine, link, ownName())
  return added.ok ? added : { ok: false, error: `${machine.label} could not save this computer: ${added.error}` }
}

/** Whether a saved machine has a project of this computer's: `there` is false while the machine clones it. */
export type ProjectOnMachine = { ok: true; there: boolean } | { ok: false; error: string }

/**
 * Have a saved machine clone a project of this computer's that it does not have, from the
 * project's repository address and with the machine's own logins: what a run sent there waits
 * for, the first time. The machine clones on its own; {@link onProjectOnMachine} says when the
 * project is there. Nothing happens on a machine that has it, or is cloning it already.
 */
export async function sendProjectToMachine(projectId: string, machineId: string): Promise<ProjectOnMachine> {
  return projectOnMachine(projectId, machineId, true)
}

/** Whether a saved machine has the project by now, or why it will not: asked while the machine clones it. */
export async function onProjectOnMachine(projectId: string, machineId: string): Promise<ProjectOnMachine> {
  return projectOnMachine(projectId, machineId, false)
}

async function projectOnMachine(projectId: string, machineId: string, bring: boolean): Promise<ProjectOnMachine> {
  const machine = (await listMachines()).find(saved => saved.id === machineId)
  if (!machine) return { ok: false, error: 'That machine is no longer saved. Pick another place to run.' }
  const cwd = typeof projectId === 'string' ? await resolveProjectPath(projectId) : undefined
  if (!cwd) return { ok: false, error: `unknown project: ${String(projectId)}` }
  const project = await repositoryAddress(cwd)
  if (!project) return { ok: false, error: 'This project has no repository address, so it cannot be sent to another machine.' }
  const target = { url: machine.url, key: machine.key, ...(machine.pin ? { pin: machine.pin } : {}), project }
  const from = bring ? await repositorySpelling(cwd) : undefined
  const said = await remoteProject(target, bring ? { share: await readSharing(cwd), ...(from !== undefined ? { from } : {}) } : undefined)
  const name = basename(cwd)
  switch (said.state) {
    case 'there':
      return { ok: true, there: true }
    case 'coming':
      return { ok: true, there: false }
    case 'missing':
      // The machine was restarted while it cloned: what it had made is gone, and a new send starts over.
      return { ok: false, error: `${machine.label} is no longer cloning ${name}. Send again.` }
    case 'failed':
      // The machine's own words: "this computer" in them is the machine.
      return { ok: false, error: `${name} could not be cloned on ${machine.label}. ${machine.label} says: ${said.error}` }
    case 'unasked':
      return { ok: false, error: `${machine.label} could not be asked for ${name}: ${said.error}` }
  }
}

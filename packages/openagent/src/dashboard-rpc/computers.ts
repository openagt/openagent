import { contextRemote } from './context.js'
import { runComputerCommand } from './modules.js'
import { saveMachine } from './machines.js'
import { computersWiring, forgetHere, ownComputersOf, reachedAtAddress, removedSince, type OwnComputers, type OwnDoor } from '../dashboard/computers-sync.js'
import { listForgotten, listMachines, removeMachine, type MachineRecord } from '../registry.js'
import { THROUGH_PATH, leaveRemote } from '../dashboard/remote-run.js'
import { parseMachineLink } from '../machine-link.js'

// What the person's computers ask each other to keep the same computers on all of them
// (computers-sync.ts): what one has, a computer handed to it, and what the person removed.

/** The package whose door this computer is reached at. */
const DEVICES = '@openagt/devices'

/** A host as a URL carries it: an IPv6 number in brackets. */
const urlHost = (host: string): string => (host.includes(':') ? `[${host}]` : host)

/** Where this computer's own door is reached at an address, when it is: a server's, or its name on Tailscale; and its id at each server it keeps a line to. */
export async function ownDoor(): Promise<OwnDoor> {
  const said = await runComputerCommand(DEVICES, ['status'])
  if (!said.ok || !said.output || typeof said.output !== 'object') return { lines: [] }
  const { listening, https, tailscale, lines } = said.output as Record<string, unknown>
  const at = (value: unknown): string | undefined => {
    const address = value && typeof value === 'object' ? (value as Record<string, unknown>).address : undefined
    return typeof address === 'string' && address ? `https://${urlHost(address)}` : undefined
  }
  const address = listening === true ? (at(https) ?? at(tailscale)) : undefined
  const kept = (Array.isArray(lines) ? lines : []).flatMap(line => {
    const { url, id } = (line && typeof line === 'object' ? line : {}) as Record<string, unknown>
    return typeof url === 'string' && typeof id === 'string' ? [{ url, id }] : []
  })
  return { ...(address ? { address } : {}), lines: kept }
}

/** A link one more device of the person's gets in with at this computer's own door: only at an address. */
export async function ownCode(): Promise<string | undefined> {
  const said = await runComputerCommand(DEVICES, ['add'])
  const url = said.ok && said.output && typeof said.output === 'object' ? (said.output as Record<string, unknown>).url : undefined
  return typeof url === 'string' && url.startsWith('https://') ? url : undefined
}

/**
 * The person's computers this one reaches at their addresses, and the ones the person removed
 * here, for another computer of theirs that brings itself up to them: never another person's.
 */
export async function onOwnComputers(): Promise<OwnComputers> {
  const [machines, forgotten, door] = await Promise.all([listMachines(), listForgotten(), computersWiring.door().catch((): OwnDoor => ({ lines: [] }))])
  return {
    ...(door.address ? { door: door.address } : {}),
    computers: machines
      .filter(machine => machine.owner === undefined && reachedAtAddress(machine))
      .map(machine => ({ url: machine.url, label: machine.label, ...(machine.host !== undefined ? { host: machine.host } : {}), ...(machine.added !== undefined ? { added: machine.added } : {}) })),
    forgotten,
  }
}

export type AddComputerResult = { ok: true } | { ok: false; error: string }

/**
 * Save a computer another of the person's computers hands this one, by the link it got in with
 * for it: this computer's own key there. Not this computer itself, not one the person removed
 * here since the other saved it (`added`), and only one reached at an address.
 */
export async function sendAddComputer(link: unknown, label: unknown, added: unknown): Promise<AddComputerResult> {
  const parsed = typeof link === 'string' ? parseMachineLink(link) : null
  if (!parsed || !reachedAtAddress({ url: parsed.url })) return { ok: false, error: 'That is no link of a computer reached at its address.' }
  const [door, forgotten, machines] = await Promise.all([computersWiring.door().catch((): OwnDoor => ({ lines: [] })), listForgotten(), listMachines()])
  if (door.address === parsed.url) return { ok: false, error: 'That is this computer.' }
  const removal = forgotten.find(gone => gone.url === parsed.url)
  if (removal && removedSince(typeof added === 'string' ? added : undefined, removal.at)) return { ok: false, error: 'The person removed that computer here.' }
  if (machines.some(machine => machine.url === parsed.url)) return { ok: true }
  const saved = await saveMachine(link as string, typeof label === 'string' ? label : undefined)
  return saved.ok ? { ok: true } : saved
}

/** Take out here the computers the person removed on another of theirs, each removed after it was saved here. */
export async function sendForgetComputers(gone: unknown): Promise<{ ok: true }> {
  const removals = ownComputersOf({ forgotten: gone }).forgotten
  await forgetHere(removals, removeHere)
  return { ok: true }
}

/** Take a computer out here, the ones saved through it with it, and this computer out there: not while a run is at work on any of them. */
async function removeHere(machine: MachineRecord): Promise<boolean> {
  const saved = await listMachines()
  const through = saved.filter(candidate => candidate.url.startsWith(`${machine.url}${THROUGH_PATH}`))
  if ([machine, ...through].some(one => contextRemote().working(one.url))) return false
  for (const one of through) await removeMachine(one.id)
  const removed = await removeMachine(machine.id)
  if (removed) void leaveRemote(removed)
  return true
}

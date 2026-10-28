import { computerName } from '../computer-name.js'
import { forgetMachine, listForgotten, listMachines, type ForgottenMachine, type MachineRecord } from '../registry.js'
import { THROUGH_PATH, machineCall } from './remote-run.js'

/**
 * The person's computers, the same on every one of them: a computer one of them saves, the others
 * save too, and one the person removes on one of them, the others take out. So every computer's
 * page reaches every other, whichever page the person opens.
 *
 * Each computer, now and then, asks each of the person's computers it reaches at an address (a
 * server, or a computer on Tailscale) what it has and what it removed. What that computer lacks,
 * this one hands it: for each of its other computers reached at an address, and for itself when
 * it has one, a code that computer gets in with, fetched from the door it is for, so every
 * computer holds a key of its own. What that computer removed after it was saved here is taken out
 * here, and what was removed here, it takes out. A computer that keeps a line to a server of the
 * person's is saved through that server, by every computer that is in there.
 *
 * Only the person's own computers: a computer of another person's, shared on a server, is never
 * handed on. Each computer still says only its own projects and runs; it only knows the others.
 */

/** One of the person's computers another computer reaches at its address, as a computer says it has it. */
export interface OwnComputer {
  url: string
  label: string
  /** The computer's own name, as it first said it. */
  host?: string
  /** When it was saved there, ISO: a removal after this one stands. */
  added?: string
}

/** What a computer says of the person's computers: the ones it reaches at their addresses, the ones the person removed there, and its own door's address. */
export interface OwnComputers {
  /** Where this computer's own door is reached, when it has an address: a server's, or its name on Tailscale. */
  door?: string
  computers: OwnComputer[]
  forgotten: ForgottenMachine[]
}

/** Whether a saved machine is one another computer reaches at the same address: a server, or a computer on Tailscale. Not one saved through a server, on a Wi-Fi, or on a line at this server. */
export function reachedAtAddress(machine: Pick<MachineRecord, 'url'>): boolean {
  return machine.url.startsWith('https://') && !machine.url.includes(THROUGH_PATH)
}

/** Whether a saved machine is a server of the person's with a door of its own: one other computers keep lines to. A computer on Tailscale keeps none. */
export function isServer(machine: Pick<MachineRecord, 'url'>): boolean {
  return reachedAtAddress(machine) && !/\.ts\.net(:\d+)?$/i.test(new URL(machine.url).host)
}

/** The longest list a computer is taken at its word for. */
const MAX_LISTED = 64

/** What a computer answered as its computers, the ones that read as such: anything else is dropped. */
export function ownComputersOf(said: unknown): OwnComputers {
  const { door, computers, forgotten } = (said && typeof said === 'object' ? said : {}) as Record<string, unknown>
  const address = (value: unknown): value is string => typeof value === 'string' && value.length <= 512 && reachedAtAddress({ url: value }) && /^https:\/\/[^/]+$/.test(value)
  const time = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
  const word = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 200
  const listed: OwnComputer[] = []
  for (const raw of Array.isArray(computers) ? computers.slice(0, MAX_LISTED) : []) {
    const { url, label, host, added } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (!address(url)) continue
    listed.push({ url, label: word(label) ? label.trim() : new URL(url).host, ...(word(host) ? { host } : {}), ...(time(added) ? { added } : {}) })
  }
  const gone: ForgottenMachine[] = []
  for (const raw of Array.isArray(forgotten) ? forgotten.slice(0, MAX_LISTED) : []) {
    const { url, at } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (typeof url === 'string' && /^https?:\/\//.test(url) && url.length <= 512 && time(at)) gone.push({ url, at })
  }
  return { ...(address(door) ? { door } : {}), computers: listed, forgotten: gone }
}

/** Whether a removal at `at` stands over a computer saved at `added`: one with no time of its own was saved before any. */
export function removedSince(added: string | undefined, at: string): boolean {
  return Date.parse(at) > (added === undefined ? -Infinity : Date.parse(added))
}

/** A computer to hand another: one of this computer's others, or this computer itself. */
export type Handed = { self: true; url: string } | { self?: undefined; machine: MachineRecord }

/**
 * What computer `there` lacks of what this one reaches at an address: each of this computer's
 * others but `there` itself, and this computer when its door has an address. One `there` has by
 * its address or its own name is not handed, nor one it removed since this computer saved it.
 */
export function lacking(there: MachineRecord, theirs: OwnComputers, mine: readonly MachineRecord[], door: string | undefined): Handed[] {
  const has = (url: string, host?: string): boolean => url === theirs.door || theirs.computers.some(computer => computer.url === url || (host !== undefined && computer.host === host))
  const removed = (url: string, added?: string): boolean => theirs.forgotten.some(gone => gone.url === url && removedSince(added, gone.at))
  const handed: Handed[] = []
  for (const machine of mine) {
    if (machine.url === there.url || machine.url === theirs.door || (machine.host !== undefined && machine.host === there.host)) continue
    if (!has(machine.url, machine.host) && !removed(machine.url, machine.added)) handed.push({ machine })
  }
  if (door !== undefined && !has(door) && !removed(door)) handed.push({ self: true, url: door })
  return handed
}

/** How long a computer that could not be handed one is not handed it again: each try makes a code at a door. */
const TRIED_KEPT_MS = 60 * 60_000

/** What this computer's own door says of itself: its address, and its id among the devices of each server it keeps a line to. */
export interface OwnDoor {
  address?: string
  lines: { url: string; id: string }[]
}

/** A computer on a line at a server, as the server lists it. */
export interface LineComputer {
  id: string
  name: string
  added: boolean
  owner?: string
}

/** What a round reaches through: the real ones, unless a test says otherwise. */
export const computersWiring: {
  env: NodeJS.ProcessEnv
  machines: () => Promise<MachineRecord[]>
  forgotten: () => Promise<ForgottenMachine[]>
  call: (machine: MachineRecord, fn: string, args: unknown[]) => Promise<{ ok: true; ret: unknown } | { ok: false; error: string }>
  door: () => Promise<OwnDoor>
  /** A link one more device of the person gets in with: at this computer's own door, or at a saved machine's. */
  ownCode: () => Promise<string | undefined>
  codeAt: (machine: MachineRecord) => Promise<string | undefined>
  /** This computer's name, as a computer it is handed to saves it by. */
  name: () => string
  /** Take out here what the person removed on another of their computers. */
  forget: (gone: readonly ForgottenMachine[]) => Promise<void>
  /** The computers on a line at a saved server, and how one is saved through it. */
  lineComputers: (server: MachineRecord) => Promise<LineComputer[] | undefined>
  saveThrough: (server: MachineRecord, id: string) => Promise<void>
  now: () => number
} = {
  env: process.env,
  machines: () => listMachines(undefined, computersWiring.env),
  forgotten: () => listForgotten(undefined, computersWiring.env),
  call: (machine, fn, args) => machineCall(machine, fn, args, 20_000),
  door: async () => (await import('../dashboard-rpc/computers.js')).ownDoor(),
  ownCode: async () => (await import('../dashboard-rpc/computers.js')).ownCode(),
  codeAt: async machine => {
    const asked = await (await import('../dashboard-rpc/machines.js')).sendMachineCode(machine.id)
    return asked.ok ? asked.value.url : undefined
  },
  name: () => computerName(),
  forget: async gone => (await import('../dashboard-rpc/computers.js')).sendForgetComputers(gone).then(() => {}),
  lineComputers: async server => {
    const asked = await (await import('../dashboard-rpc/machines.js')).onComputersThrough(server.id)
    return asked.ok ? asked.computers : undefined
  },
  saveThrough: async (server, id) => void (await (await import('../dashboard-rpc/machines.js')).saveComputerThrough(server.id, id)),
  now: () => Date.now(),
}

/** When each computer was last handed one it could not take, by both their addresses. */
const tried = new Map<string, number>()

/** One round: each of the person's computers reached at an address is brought up to this one's, and this one to theirs. */
export async function syncComputers(): Promise<void> {
  const w = computersWiring
  const [saved, forgotten, door] = await Promise.all([w.machines(), w.forgotten(), w.door().catch((): OwnDoor => ({ lines: [] }))])
  const own = saved.filter(machine => machine.owner === undefined)
  const atAddress = own.filter(reachedAtAddress)
  for (const there of atAddress) {
    const said = await w.call(there, 'onOwnComputers', [])
    if (!said.ok) continue
    const theirs = ownComputersOf(said.ret)
    // What the person removed there after it was saved here goes here too.
    await w.forget(theirs.forgotten)
    // What was removed here, it takes out.
    const removedHere = forgotten.filter(gone => theirs.computers.some(computer => computer.url === gone.url && removedSince(computer.added, gone.at)))
    if (removedHere.length > 0) await w.call(there, 'sendForgetComputers', [removedHere])
    for (const handed of lacking(there, theirs, atAddress, door.address)) {
      const url = handed.self ? handed.url : handed.machine.url
      const key = `${there.url} ${url}`
      if (w.now() - (tried.get(key) ?? -Infinity) < TRIED_KEPT_MS) continue
      tried.set(key, w.now())
      const link = handed.self ? await w.ownCode().catch(() => undefined) : await w.codeAt(handed.machine).catch(() => undefined)
      if (link === undefined) continue
      const label = handed.self ? w.name() : handed.machine.label
      const took = await w.call(there, 'sendAddComputer', [link, label, handed.self ? null : (handed.machine.added ?? null)])
      // Taken: it may be handed again, should it ever lack it.
      if (took.ok && (took.ret as { ok?: unknown } | undefined)?.ok === true) tried.delete(key)
    }
  }
  // Each server of the person's: their own computers that keep a line there, saved here through it.
  for (const server of own.filter(isServer)) {
    const listed = await w.lineComputers(server).catch(() => undefined)
    const mine = door.lines.find(line => line.url === server.url)?.id
    for (const computer of listed ?? []) {
      if (computer.owner !== undefined || computer.added || computer.id === mine) continue
      if (forgotten.some(gone => gone.url === `${server.url}${THROUGH_PATH}${computer.id}`)) continue
      await w.saveThrough(server, computer.id).catch(() => {})
    }
  }
}

/** How often a round runs, and how soon after the person saved or removed a computer. */
const EVERY_MS = 2 * 60_000
const SOON_MS = 3_000

let running: Promise<void> | undefined
let soon: NodeJS.Timeout | undefined
let started = false

function round(): void {
  running ??= syncComputers()
    .catch(() => {})
    .finally(() => (running = undefined))
}

/** A round in a moment, when the computers sync at all: the person just saved or removed one. */
export function syncComputersSoon(): void {
  if (!started || soon) return
  soon = setTimeout(() => {
    soon = undefined
    round()
  }, SOON_MS)
  soon.unref()
}

/** Keep the person's computers the same on all of them, from now on: a round every few minutes, the first a moment after the start. */
export function startComputersSync(env: NodeJS.ProcessEnv): () => void {
  computersWiring.env = env
  started = true
  const first = setTimeout(round, 20_000)
  const timer = setInterval(round, EVERY_MS)
  first.unref()
  timer.unref()
  return () => {
    started = false
    clearTimeout(first)
    clearInterval(timer)
    if (soon) clearTimeout(soon)
    soon = undefined
  }
}

/** Take out here the computers the person removed on another of theirs, after each was saved here: through-saved ones with the server they go through. */
export async function forgetHere(gone: readonly ForgottenMachine[], remove: (machine: MachineRecord) => Promise<boolean>): Promise<void> {
  const saved = await computersWiring.machines()
  for (const removal of gone) {
    const machine = saved.find(candidate => candidate.url === removal.url)
    if (machine && !removedSince(machine.added, removal.at)) continue
    if (machine && !(await remove(machine))) continue
    await forgetMachine(removal.url, removal.at, undefined, computersWiring.env)
  }
}

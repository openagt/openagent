import type { ModuleHost } from '@openagt/dashboard/module'

// What the section shows: the answer of `devices status`, read forgivingly, and the three
// things a person does, each one of the package's own commands. The devices are this computer's,
// not a project's: each command runs in no project, so the section is there with no project added.

/** A phone or a browser that is in. */
export interface DeviceRow {
  id: string
  name: string
  added: string
  seen?: string
  /** A computer that keeps a line open here: this server starts runs on it. */
  line?: true
  /** A computer is one row: the ids of what else it holds here, its line beside its key for OpenAgent. */
  also?: string[]
  /** Whose device it is, by their name, once this computer has persons. */
  person?: string
}

/** A person on this computer, by their name; the owner first. */
export interface PersonRow {
  name: string
  owner?: true
  /** On a computer that gives each person a user of their own: theirs is made. */
  ready?: true
  /** Theirs is being made right now. */
  working?: true
  /** Why theirs could not be made. */
  problem?: string
  /** The server whose line made them here, by its door: they start runs on this computer through it. */
  from?: string
  /** That server no longer has them: the owner says whether they stay. */
  removed?: true
  /** The owner said they stay. */
  kept?: true
}

/** Every id a row is listed under. */
export const idsOf = (device: Pick<DeviceRow, 'id' | 'also'>): string[] => [device.id, ...(device.also ?? [])]

/** The door as `status` tells it. */
export interface DoorStatus {
  on: boolean
  listening: boolean
  problem?: string
  /** On a server: the address its door is open at, over HTTPS, to every network. */
  https?: { address: string }
  /** Behind Tailscale: this computer's name on the person's Tailscale network, which its door is open at. */
  tailscale?: { address: string }
  /** Where the person fixes the problem themselves, in an account of theirs: Tailscale's page that turns Serve on. */
  fixAt?: string
  devices: DeviceRow[]
  /** None until the owner is named. */
  persons: PersonRow[]
  /**
   * Set on the OpenAgent of one person on a computer several people use, to their name:
   * their devices are the door's, asked of it with {@link loadMine}, and this OpenAgent has none of its own.
   */
  person?: string
}

/** The link a new device gets in with: what the QR code holds. */
export interface AddLink {
  url: string
  /** The same link by this computer's number, when `url` goes by its name. */
  numberUrl?: string
  expires: string
}

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string }

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

export function readStatus(output: unknown): DoorStatus | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { on, listening, problem, https, tailscale, fixAt, devices, persons, person } = output as Record<string, unknown>
  if (typeof on !== 'boolean' || !Array.isArray(devices)) return undefined
  const rows = readDevices(devices)
  const people: PersonRow[] = []
  for (const entry of Array.isArray(persons) ? persons : []) {
    const { name, owner, ready, working, problem, from, removed, kept } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const [known, why, came] = [text(name), text(problem), text(from)]
    if (known && !people.some(person => person.name === known))
      people.push({
        name: known,
        ...(owner === true ? { owner: true as const } : {}),
        ...(ready === true ? { ready: true as const } : {}),
        ...(working === true ? { working: true as const } : {}),
        ...(why ? { problem: why } : {}),
        ...(came ? { from: came } : {}),
        ...(removed === true ? { removed: true as const } : {}),
        ...(kept === true ? { kept: true as const } : {}),
      })
  }
  const why = text(problem)
  const address = https && typeof https === 'object' ? text((https as Record<string, unknown>).address) : undefined
  const named = tailscale && typeof tailscale === 'object' ? text((tailscale as Record<string, unknown>).address) : undefined
  // Only Tailscale's own page: what the page links to is no address a command could name.
  const fix = text(fixAt)?.startsWith('https://login.tailscale.com/') ? text(fixAt) : undefined
  const own = text(person)
  return {
    on,
    listening: listening === true,
    ...(why ? { problem: why } : {}),
    ...(why && fix ? { fixAt: fix } : {}),
    ...(address ? { https: { address } } : {}),
    ...(named ? { tailscale: { address: named } } : {}),
    devices: rows,
    persons: people,
    ...(own ? { person: own } : {}),
  }
}

/** The devices of a list, read forgivingly: an entry that is not one is left out. */
function readDevices(devices: unknown[]): DeviceRow[] {
  const rows: DeviceRow[] = []
  for (const entry of devices) {
    if (!entry || typeof entry !== 'object') continue
    const { id, name, added, seen, line, also, person } = entry as Record<string, unknown>
    const [deviceId, deviceName, addedAt, seenAt, whose] = [text(id), text(name), text(added), text(seen), text(person)]
    const others = Array.isArray(also) ? also.filter((other): other is string => typeof other === 'string' && other !== '') : []
    if (deviceId && deviceName && addedAt) rows.push({ id: deviceId, name: deviceName, added: addedAt, ...(seenAt ? { seen: seenAt } : {}), ...(line === true ? { line: true } : {}), ...(others.length ? { also: others } : {}), ...(whose ? { person: whose } : {}) })
  }
  return rows
}

/** What the door tells a device of itself: its person, whether that is the owner, and that person's devices. */
export interface Mine {
  /** Their name, once the computer has persons. */
  person?: string
  owner: boolean
  devices: DeviceRow[]
}

export function readMine(output: unknown): Mine | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { person, owner, devices } = output as Record<string, unknown>
  if (typeof owner !== 'boolean' || !Array.isArray(devices)) return undefined
  const who = text(person)
  return { ...(who ? { person: who } : {}), owner, devices: readDevices(devices) }
}

/** Where the door answers a device about itself: on the page's own address, which the door serves. */
const ME_PATH = '/_devices/me'

/**
 * Ask the door, from the page it serves, what this device's person has there. Asked by the page
 * itself and not by a command: the devices are in the door's file, the owner's, which this
 * person's OpenAgent cannot read; the door answers the device by its own cookie.
 */
async function askDoor(path: string, init?: RequestInit, fetchFn: typeof fetch = fetch): Promise<Answer<Mine>> {
  try {
    const res = await fetchFn(path, { credentials: 'same-origin', cache: 'no-store', ...init })
    if (!res.ok) return { ok: false, error: (await res.text().catch(() => '')).trim() || `the door answered ${res.status}` }
    const mine = readMine(await res.json())
    return mine ? { ok: true, value: mine } : { ok: false, error: 'the door answered something else than expected' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export const loadMine = (fetchFn?: typeof fetch): Promise<Answer<Mine>> => askDoor(ME_PATH, undefined, fetchFn)
/** Take one of this person's devices out, a computer with all it holds there. */
export const removeMine = (id: string, fetchFn?: typeof fetch): Promise<Answer<Mine>> => askDoor(`${ME_PATH}/remove`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }, fetchFn)

function readLink(output: unknown): AddLink | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { url, numberUrl, expires } = output as Record<string, unknown>
  const [link, byNumber, until] = [text(url), text(numberUrl), text(expires)]
  return link && until ? { url: link, ...(byNumber ? { numberUrl: byNumber } : {}), expires: until } : undefined
}

async function run<T>(host: ModuleHost, args: string[], read: (output: unknown) => T | undefined): Promise<Answer<T>> {
  const result = await host.runComputerCommand(args).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
  if (!result.ok) return result
  const value = read(result.output)
  return value !== undefined ? { ok: true, value } : { ok: false, error: 'the command answered something else than expected' }
}

export const loadStatus = (host: ModuleHost): Promise<Answer<DoorStatus>> => run(host, ['status'], readStatus)
export const setSwitch = (host: ModuleHost, on: boolean): Promise<Answer<DoorStatus>> => run(host, [on ? 'on' : 'off'], readStatus)
/** Behind Tailscale or not: the door is open to the person's own devices on their Tailscale network. */
export const setTailscale = (host: ModuleHost, on: boolean): Promise<Answer<DoorStatus>> => run(host, ['tailscale', on ? 'on' : 'off'], readStatus)
export const addDevice = (host: ModuleHost, person?: string): Promise<Answer<AddLink>> => run(host, ['add', ...(person !== undefined ? ['--for', person] : [])], readLink)
export const nameOwner = (host: ModuleHost, name: string): Promise<Answer<DoorStatus>> => run(host, ['owner', name], readStatus)
export const removePerson = (host: ModuleHost, name: string): Promise<Answer<DoorStatus>> => run(host, ['remove-person', name], readStatus)
/** Keep a person a server's line made here, though that server no longer has them. */
export const keepPerson = (host: ModuleHost, name: string): Promise<Answer<DoorStatus>> => run(host, ['keep', name], readStatus)

/** The name of the person at this computer, as git knows it; nothing when git has none, or the question failed. */
export async function myName(host: ModuleHost): Promise<string | undefined> {
  const answer = await run(host, ['me'], output => (output && typeof output === 'object' ? (output as Record<string, unknown>) : undefined))
  return answer.ok ? text(answer.value.name) : undefined
}
export const removeDevice = (host: ModuleHost, id: string): Promise<Answer<DoorStatus>> => run(host, ['remove', id], readStatus)
/** Call a device by another name: a computer under all it holds here. */
export const renameDevice = (host: ModuleHost, id: string, name: string): Promise<Answer<DoorStatus>> => run(host, ['rename', id, name], readStatus)

// Pairing on this Wi-Fi: the computers found there, this computer's ask at one of them, and the
// asks waiting here for Allow or Deny.

/** A computer found on this Wi-Fi, its door open there. */
export interface FoundComputer {
  name: string
  version?: string
  /** Where its door is: what it is asked at. */
  url: string
}

/** This computer's ask at another: the number both screens show, and the secret it hears the answer by. */
export interface AskedThere {
  number: string
  secret: string
  expires: string
}

/** What this computer hears of its ask. */
export type AskAnswer = { state: 'waiting' } | { state: 'denied' } | { state: 'gone' } | { state: 'allowed'; link: string; numberLink?: string }

/** A computer on this Wi-Fi asking to get in here. */
export interface AskHere {
  id: string
  name: string
  number: string
  expires: string
}

const record = (value: unknown): Record<string, unknown> | undefined => (value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined)

function readFound(output: unknown): FoundComputer[] | undefined {
  const found = record(output)?.found
  if (!Array.isArray(found)) return undefined
  return found.flatMap(entry => {
    const { name, version, url } = record(entry) ?? {}
    const [said, at, v] = [text(name), text(url), text(version)]
    return said && at ? [{ name: said, url: at, ...(v ? { version: v } : {}) }] : []
  })
}

function readAsks(output: unknown): AskHere[] | undefined {
  const asks = record(output)?.asks
  if (!Array.isArray(asks)) return undefined
  return asks.flatMap(entry => {
    const { id, name, number, expires } = record(entry) ?? {}
    const [which, said, shown, until] = [text(id), text(name), text(number), text(expires)]
    return which && said && shown && until ? [{ id: which, name: said, number: shown, expires: until }] : []
  })
}

/** The computers whose door is open on this Wi-Fi: a look of a few seconds. */
export const findComputers = (host: ModuleHost): Promise<Answer<FoundComputer[]>> => run(host, ['find'], readFound)

/** Ask the computer whose door is at `url` to let this one in. */
export const askComputer = (host: ModuleHost, url: string): Promise<Answer<AskedThere>> =>
  run(host, ['ask', url], output => {
    const { number, secret, expires } = record(output) ?? {}
    const [shown, word, until] = [text(number), text(secret), text(expires)]
    return shown && word && until ? { number: shown, secret: word, expires: until } : undefined
  })

/** Whether a person there answered: waits a while for it. The secret goes on standard input. */
export async function hearAnswer(host: ModuleHost, url: string, secret: string): Promise<Answer<AskAnswer>> {
  const result = await host.runComputerCommand(['ask-answer', url, '-'], undefined, secret).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
  if (!result.ok) return result
  const { state, link, numberLink } = record(result.output) ?? {}
  if (state === 'allowed' && text(link)) return { ok: true, value: { state, link: text(link)!, ...(text(numberLink) ? { numberLink: text(numberLink)! } : {}) } }
  if (state === 'waiting' || state === 'denied' || state === 'gone') return { ok: true, value: { state } }
  return { ok: false, error: 'the command answered something else than expected' }
}

/** Take this computer's ask away there. */
export const cancelAsk = (host: ModuleHost, url: string, secret: string): Promise<unknown> => host.runComputerCommand(['ask-cancel', url, '-'], undefined, secret).catch(() => undefined)

/** The asks waiting here; with `seen`, the answer waits up to 25 seconds for them to be other than that. */
export const loadAsks = (host: ModuleHost, seen?: readonly string[]): Promise<Answer<AskHere[]>> => run(host, ['asks', ...(seen ? ['--wait', '25', '--seen', seen.join(',')] : [])], readAsks)

/** Allow the ask `id`, or deny it. */
export const answerAsk = (host: ModuleHost, id: string, allow: boolean): Promise<Answer<AskHere[]>> => run(host, [allow ? 'allow' : 'deny', id], readAsks)

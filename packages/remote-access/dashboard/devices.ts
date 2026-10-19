import type { ModuleHost } from '@openagt/dashboard/module'

// What the section shows: the answer of `remote-access status`, read forgivingly, and the three
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
  /** Whose device it is, by their GitHub account, once this computer has persons. */
  person?: string
}

/** A person on this computer, by their GitHub account; the owner first. */
export interface PersonRow {
  account: string
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
  devices: DeviceRow[]
  /** None until the owner is named. */
  persons: PersonRow[]
  /**
   * Set on the OpenAgent of one person on a computer several people use, to their GitHub account:
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
  const { on, listening, problem, https, devices, persons, person } = output as Record<string, unknown>
  if (typeof on !== 'boolean' || !Array.isArray(devices)) return undefined
  const rows = readDevices(devices)
  const people: PersonRow[] = []
  for (const entry of Array.isArray(persons) ? persons : []) {
    const { account, owner, ready, working, problem, from, removed, kept } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const [known, why, came] = [text(account), text(problem), text(from)]
    if (known && !people.some(person => person.account === known))
      people.push({
        account: known,
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
  const own = text(person)
  return { on, listening: listening === true, ...(why ? { problem: why } : {}), ...(address ? { https: { address } } : {}), devices: rows, persons: people, ...(own ? { person: own } : {}) }
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
  account?: string
  owner: boolean
  devices: DeviceRow[]
}

export function readMine(output: unknown): Mine | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { account, owner, devices } = output as Record<string, unknown>
  if (typeof owner !== 'boolean' || !Array.isArray(devices)) return undefined
  const who = text(account)
  return { ...(who ? { account: who } : {}), owner, devices: readDevices(devices) }
}

/** Where the door answers a device about itself: on the page's own address, which the door serves. */
const ME_PATH = '/_remote-access/me'

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
export const addDevice = (host: ModuleHost, person?: string): Promise<Answer<AddLink>> => run(host, ['add', ...(person !== undefined ? ['--for', person] : [])], readLink)
export const nameOwner = (host: ModuleHost, account: string): Promise<Answer<DoorStatus>> => run(host, ['owner', account], readStatus)
export const removePerson = (host: ModuleHost, account: string): Promise<Answer<DoorStatus>> => run(host, ['remove-person', account], readStatus)
/** Keep a person a server's line made here, though that server no longer has them. */
export const keepPerson = (host: ModuleHost, account: string): Promise<Answer<DoorStatus>> => run(host, ['keep', account], readStatus)

/** The GitHub account `gh` is logged in to on this computer, or why there is none. */
export async function ownGithub(host: ModuleHost): Promise<{ ok: true; account: string } | { ok: false; error: string }> {
  const answer = await run(host, ['github'], output => (output && typeof output === 'object' ? (output as Record<string, unknown>) : undefined))
  if (!answer.ok) return answer
  const account = text(answer.value.account)
  return account ? { ok: true, account } : { ok: false, error: text(answer.value.problem) ?? 'GitHub did not say who is logged in here.' }
}
export const removeDevice = (host: ModuleHost, id: string): Promise<Answer<DoorStatus>> => run(host, ['remove', id], readStatus)

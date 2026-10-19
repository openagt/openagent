import { lastLines, openSession, withAdvice, type Exec } from './ssh.js'
import { SERVER_USER, devicesScript, ownerScript, removeDeviceScript, removePersonScript } from './steps.js'
import { isAccount, type Server } from './store.js'

/**
 * The devices that are in on a server, as its door lists them: asked over SSH, so a person sees
 * them, and takes one out, from the computer the server was set up from. What a server answers
 * is read as data: nothing of it is trusted beyond what a list of devices holds.
 */

/** A phone, a browser or a computer that is in on a server. */
export interface ServerDevice {
  id: string
  name: string
  /** ISO 8601. */
  added: string
  /** ISO 8601; absent until the device made a request after getting in. */
  seen?: string
  /** A computer that keeps a line open to the server. */
  line?: true
  /** A computer is listed once: the ids of what else it holds on the server, its line beside its key for OpenAgent. */
  also?: string[]
  /** That computer is this one: the line this computer keeps open to the server. */
  own?: true
  /** Whose device it is, by their GitHub account, once the server has persons. */
  person?: string
}

/** A person on the server, by their GitHub account; the owner first. */
export interface ServerPerson {
  account: string
  owner?: true
}

/** Every id a row is listed under: its own, and those of what else the computer holds there. */
export const idsOf = (device: Pick<ServerDevice, 'id' | 'also'>): string[] => [device.id, ...(device.also ?? [])]

export type Devices = { ok: true; devices: ServerDevice[]; persons: ServerPerson[] } | { ok: false; error: string }

/** How long the server gets to answer: less than a page's command has, so the line is always hung up. */
const DEVICES_TIMEOUT_MS = 20_000
/** As many as a door keeps, and a name as long as it keeps one. */
const MAX_DEVICES = 50
const MAX_NAME = 80
/** A computer holds a key for OpenAgent and a line: more than a few ids under one row is no row a door makes. */
const MAX_ALSO = 4

/** A device's id as a door makes one: nothing else is ever handed to a server as an id. */
export const isDeviceId = (said: string): boolean => /^[a-z0-9]{6,32}$/.test(said)

/** A time a server said, written anew as ISO 8601: nothing of how the server wrote it is kept. `undefined` for what is no time. */
function timeOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 40) return undefined
  const at = Date.parse(value)
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined
}

/** How much of what a server said of a failure is told. */
const MAX_SAID = 2_000

/** A person's GitHub account as a door writes it: in small letters. */
const accountIn = (said: unknown): string | undefined => (isAccount(said) && said === said.toLowerCase() ? said : undefined)

/** The devices and persons in what a door's `status` printed, or `undefined` for what is no such answer. */
export function devicesIn(out: string): { devices: ServerDevice[]; persons: ServerPerson[] } | undefined {
  let answer: Record<string, unknown> | null
  try {
    answer = JSON.parse(out.trim().split('\n').at(-1) ?? '') as Record<string, unknown> | null
  } catch {
    return undefined
  }
  const listed = answer?.devices
  if (!Array.isArray(listed)) return undefined
  // The owner first and once, then each other person once: a door that says otherwise is read as having none.
  const persons: ServerPerson[] = []
  for (const entry of Array.isArray(answer?.persons) ? answer.persons : []) {
    if (persons.length >= MAX_DEVICES) break
    const { account, owner } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const known = accountIn(account)
    if (known === undefined || persons.some(person => person.account === known)) continue
    // A door lists its owner first: a list that does not start with one is no list of persons.
    if (!persons.length && owner !== true) break
    if (!persons.length) persons.push({ account: known, owner: true })
    else if (owner !== true) persons.push({ account: known })
  }
  const devices: ServerDevice[] = []
  for (const entry of listed) {
    if (devices.length >= MAX_DEVICES) break
    if (!entry || typeof entry !== 'object') continue
    const { id, name, added, seen, line, also, person } = entry as Record<string, unknown>
    const whose = accountIn(person)
    const [since, last] = [timeOf(added), timeOf(seen)]
    const known = (candidate: string): boolean => devices.some(device => idsOf(device).includes(candidate))
    if (typeof id !== 'string' || !isDeviceId(id) || since === undefined || known(id)) continue
    // What else the computer holds there: ids as a door makes them, each listed once in all.
    const others: string[] = []
    for (const other of Array.isArray(also) ? also : []) if (others.length < MAX_ALSO && typeof other === 'string' && isDeviceId(other) && other !== id && !others.includes(other) && !known(other)) others.push(other)
    // A name is what a browser said it is: shown as words, with nothing in it that moves a line or turns its letters around.
    const words = typeof name === 'string' ? name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, MAX_NAME) : ''
    devices.push({ id, name: words || 'A device', added: since, ...(last !== undefined ? { seen: last } : {}), ...(line === true ? { line: true } : {}), ...(others.length ? { also: others } : {}), ...(whose !== undefined && persons.some(known => known.account === whose) ? { person: whose } : {}) })
  }
  return { devices, persons }
}

async function ask(server: Pick<Server, 'address' | 'user'>, script: string, opts: { exec?: Exec }): Promise<Devices> {
  const session = await openSession(server, opts)
  try {
    const said = await session.run(SERVER_USER, script, DEVICES_TIMEOUT_MS)
    if (said.code !== 0) return { ok: false, error: withAdvice(server, lastLines(said).slice(-MAX_SAID) || 'The server did not answer.') }
    const listed = devicesIn(said.out)
    return listed ? { ok: true, ...listed } : { ok: false, error: 'The server answered something else than the devices that are in.' }
  } finally {
    await session.close()
  }
}

/** Ask the server's door which devices are in. */
export const readDevices = (server: Pick<Server, 'address' | 'user'>, opts: { exec?: Exec } = {}): Promise<Devices> => ask(server, devicesScript(), opts)

/** Name the server's owner at its door, by their GitHub account: the devices already in are theirs. */
export function nameOwner(server: Pick<Server, 'address' | 'user'>, account: string, opts: { exec?: Exec } = {}): Promise<Devices> {
  if (!isAccount(account)) return Promise.resolve({ ok: false, error: `${account} is not a GitHub account` })
  return ask(server, ownerScript(account.toLowerCase()), opts)
}

/** Take a person out at the server's door, with every device of theirs. Answers the ones still in. */
export function removePerson(server: Pick<Server, 'address' | 'user'>, account: string, opts: { exec?: Exec } = {}): Promise<Devices> {
  if (!isAccount(account)) return Promise.resolve({ ok: false, error: `${account} is not a GitHub account` })
  return ask(server, removePersonScript(account.toLowerCase()), opts)
}

/** Take one device out at the server's door: it is out at once. Answers the ones still in. */
export async function removeDevice(server: Pick<Server, 'address' | 'user'>, id: string, opts: { exec?: Exec } = {}): Promise<Devices> {
  if (!isDeviceId(id)) return { ok: false, error: `${id} is not a device's id` }
  return ask(server, removeDeviceScript(id), opts)
}

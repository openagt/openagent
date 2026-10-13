import { lastLines, openSession, withAdvice, type Exec } from './ssh.js'
import { SERVER_USER, devicesScript, removeDeviceScript } from './steps.js'
import type { Server } from './store.js'

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
  /** That computer is this one: the line this computer keeps open to the server. */
  own?: true
}

export type Devices = { ok: true; devices: ServerDevice[] } | { ok: false; error: string }

/** How long the server gets to answer: less than a page's command has, so the line is always hung up. */
const DEVICES_TIMEOUT_MS = 20_000
/** As many as a door keeps, and a name as long as it keeps one. */
const MAX_DEVICES = 50
const MAX_NAME = 80

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

/** The devices in what a door's `status` printed, or `undefined` for what is no such answer. */
export function devicesIn(out: string): ServerDevice[] | undefined {
  let listed: unknown
  try {
    listed = (JSON.parse(out.trim().split('\n').at(-1) ?? '') as Record<string, unknown> | null)?.devices
  } catch {
    return undefined
  }
  if (!Array.isArray(listed)) return undefined
  const devices: ServerDevice[] = []
  for (const entry of listed) {
    if (devices.length >= MAX_DEVICES) break
    if (!entry || typeof entry !== 'object') continue
    const { id, name, added, seen, line } = entry as Record<string, unknown>
    const [since, last] = [timeOf(added), timeOf(seen)]
    if (typeof id !== 'string' || !isDeviceId(id) || since === undefined || devices.some(device => device.id === id)) continue
    // A name is what a browser said it is: shown as words, with nothing in it that moves a line or turns its letters around.
    const words = typeof name === 'string' ? name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, MAX_NAME) : ''
    devices.push({ id, name: words || 'A device', added: since, ...(last !== undefined ? { seen: last } : {}), ...(line === true ? { line: true } : {}) })
  }
  return devices
}

async function ask(server: Pick<Server, 'address' | 'user'>, script: string, opts: { exec?: Exec }): Promise<Devices> {
  const session = await openSession(server, opts)
  try {
    const said = await session.run(SERVER_USER, script, DEVICES_TIMEOUT_MS)
    if (said.code !== 0) return { ok: false, error: withAdvice(server, lastLines(said).slice(-MAX_SAID) || 'The server did not answer.') }
    const devices = devicesIn(said.out)
    return devices ? { ok: true, devices } : { ok: false, error: 'The server answered something else than the devices that are in.' }
  } finally {
    await session.close()
  }
}

/** Ask the server's door which devices are in. */
export const readDevices = (server: Pick<Server, 'address' | 'user'>, opts: { exec?: Exec } = {}): Promise<Devices> => ask(server, devicesScript(), opts)

/** Take one device out at the server's door: it is out at once. Answers the ones still in. */
export async function removeDevice(server: Pick<Server, 'address' | 'user'>, id: string, opts: { exec?: Exec } = {}): Promise<Devices> {
  if (!isDeviceId(id)) return { ok: false, error: `${id} is not a device's id` }
  return ask(server, removeDeviceScript(id), opts)
}

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * The door's own file, in the person's home folder: whether the door is open, the devices that
 * are in, the codes waiting to be scanned, and where the door listens while it does. The command
 * and the door's process both write it, so every change goes through {@link update}.
 *
 * A device's key and a code are kept as their SHA-256 only: the file never holds what would let
 * someone in.
 */

/** A phone or a browser that is in. */
export interface Device {
  id: string
  /** What the device said it is when it got in: "iPhone, Safari". */
  name: string
  /** The SHA-256 of the device's key, hex. */
  key: string
  /** ISO 8601. */
  added: string
  /** ISO 8601; absent until the device made a request after getting in. */
  seen?: string
}

/** A code a new device gets in with, once. */
export interface Code {
  /** The SHA-256 of the code, hex. */
  code: string
  /** ISO 8601. */
  expires: string
}

/** Where the door listens, written by its process while it does. */
export interface Listening {
  pid: number
  port: number
}

export interface Store {
  /** The "Phone on Wi-Fi" switch. */
  on: boolean
  devices: Device[]
  codes: Code[]
  listening?: Listening
  /** Why the door is not listening although the switch is on, in words. */
  problem?: string
}

/** How long a code is good for. */
export const CODE_LIFETIME_MS = 5 * 60 * 1000
/** Caps, so a file edited by hand or a flood of scans cannot bloat it. */
export const MAX_DEVICES = 50
export const MAX_CODES = 20
const MAX_NAME = 80

const FILE = 'openagent-remote-access.json'

/** The file's path: beside OpenAgent's own home file, by the same rule. */
export function storePath(env: NodeJS.ProcessEnv): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, FILE)
  return join(env.HOME ?? '', '.' + FILE)
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** A secret a device or a code is: 32 random bytes, URL-safe. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url')
}

/** Constant-time compare of two hex digests. */
export function sameDigest(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

const isIso = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/** Read what a file holds, forgivingly: anything malformed is left out, never a reason to fail. */
export function sanitize(value: unknown): Store {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const devices: Device[] = []
  for (const entry of Array.isArray(obj.devices) ? obj.devices : []) {
    if (devices.length >= MAX_DEVICES) break
    if (!entry || typeof entry !== 'object') continue
    const { id, name, key, added, seen } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !/^[a-z0-9]{6,32}$/.test(id) || !isDigest(key) || !isIso(added)) continue
    if (devices.some(device => device.id === id)) continue
    devices.push({ id, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME) : 'A device', key, added, ...(isIso(seen) ? { seen } : {}) })
  }
  const codes: Code[] = []
  for (const entry of Array.isArray(obj.codes) ? obj.codes : []) {
    if (!entry || typeof entry !== 'object') continue
    const { code, expires } = entry as Record<string, unknown>
    if (isDigest(code) && isIso(expires)) codes.push({ code, expires })
  }
  const listening = obj.listening && typeof obj.listening === 'object' ? (obj.listening as Record<string, unknown>) : undefined
  return {
    on: obj.on === true,
    devices,
    codes: codes.slice(-MAX_CODES),
    ...(listening && Number.isInteger(listening.pid) && Number.isInteger(listening.port) ? { listening: { pid: listening.pid as number, port: listening.port as number } } : {}),
    ...(typeof obj.problem === 'string' && obj.problem ? { problem: obj.problem } : {}),
  }
}

/** The file is there and cannot be read as what it should hold: a typo made by hand, a disk that failed. */
export class Unreadable extends Error {
  constructor(path: string) {
    super(`${path} cannot be read: correct it, or delete it to start with no device`)
  }
}

/** The file as it stands, or `'unreadable'`; no file reads as a closed door with nobody in. */
export async function readStoreStrict(env: NodeJS.ProcessEnv): Promise<Store | 'unreadable'> {
  let text: string
  try {
    text = await readFile(storePath(env), 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? sanitize(undefined) : 'unreadable'
  }
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? sanitize(value) : 'unreadable'
  } catch {
    return 'unreadable'
  }
}

/** The same for a reader that lets nobody in on a doubt: an unreadable file reads as a closed door with nobody in. */
export async function readStore(env: NodeJS.ProcessEnv): Promise<Store> {
  const store = await readStoreStrict(env)
  return store === 'unreadable' ? sanitize(undefined) : store
}

/** How long a writer waits for the lock, and how old a lock is taken over whoever holds it: a change takes milliseconds. */
const LOCK_WAIT_MS = 5_000
const LOCK_OLD_MS = 30_000

/** Whether the lock is one left behind: its writer is gone, or it is far older than any change takes. */
async function leftBehind(lock: string): Promise<boolean> {
  const [held, age] = await Promise.all([readFile(lock, 'utf8').catch(() => undefined), stat(lock).then(s => Date.now() - s.mtimeMs, () => 0)])
  if (held === undefined) return false
  const pid = Number(held.split(':')[0])
  return age > LOCK_OLD_MS || !Number.isInteger(pid) || !pidAlive(pid)
}

async function withLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`
  // The writer's name on the lock: a writer never removes a lock that is not its own.
  const mine = `${process.pid}:${randomBytes(8).toString('hex')}`
  await mkdir(dirname(path), { recursive: true })
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      await writeFile(lock, mine, { flag: 'wx', mode: 0o600 })
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      // A writer that died holding the lock must not shut every later one out. Looked at twice,
      // so a lock another waiter just took over is not taken from it.
      if ((await leftBehind(lock)) && (await leftBehind(lock))) await rm(lock, { force: true })
      else if (Date.now() > deadline) throw new Error('the devices file is held by another writer')
      else await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    return await run()
  } finally {
    if ((await readFile(lock, 'utf8').catch(() => undefined)) === mine) await rm(lock, { force: true })
  }
}

/**
 * Change the file: read it, apply `change`, write it back, with no other writer in between.
 * Written to a temporary file and renamed, so a reader never sees half a file, owner-only.
 * `change` answers what the caller wants to know of the change. Throws {@link Unreadable} for a
 * file that is there and cannot be read.
 */
export async function update<T>(env: NodeJS.ProcessEnv, change: (store: Store) => T): Promise<T> {
  const path = storePath(env)
  return withLock(path, async () => {
    const store = await readStoreStrict(env)
    // Never written over: what a person typed wrong is theirs to correct, with every device still in it.
    if (store === 'unreadable') throw new Unreadable(path)
    const answer = change(store)
    const tmp = `${path}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(sanitize(store), null, 2) + '\n', { mode: 0o600 })
    await rename(tmp, path)
    return answer
  })
}

/** Whether a process with this id is running. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The codes still good at `now`. */
export function liveCodes(codes: readonly Code[], now: number): Code[] {
  return codes.filter(code => Date.parse(code.expires) > now)
}

/** Make a code a new device gets in with; answers the code itself, which the file does not keep. */
export async function addCode(env: NodeJS.ProcessEnv, now = Date.now()): Promise<{ code: string; expires: string }> {
  // Half the length of a device's key: it lives five minutes and works once, and a shorter link is a QR code a camera reads more easily.
  const code = randomBytes(16).toString('base64url')
  const expires = new Date(now + CODE_LIFETIME_MS).toISOString()
  await update(env, store => {
    store.codes = [...liveCodes(store.codes, now), { code: sha256(code), expires }].slice(-MAX_CODES)
  })
  return { code, expires }
}

/** What a device holds once it is in: its id and its key, as the cookie carries them. */
export interface Entry {
  id: string
  key: string
}

/**
 * Let a new device in with `code`: the code is spent, the device is saved, and its key is
 * answered once. `undefined` for a code that is unknown, spent or too old, and when the list is full.
 */
export async function enter(env: NodeJS.ProcessEnv, code: string, name: string, now = Date.now()): Promise<Entry | undefined> {
  const digest = sha256(code)
  // Looked up before the file is locked: a flood of wrong codes from the network changes nothing and holds no writer up.
  if (!liveCodes((await readStore(env)).codes, now).some(candidate => sameDigest(candidate.code, digest))) return undefined
  return update(env, store => {
    const live = liveCodes(store.codes, now)
    const match = live.find(candidate => sameDigest(candidate.code, digest))
    store.codes = live.filter(candidate => candidate !== match)
    if (!match || store.devices.length >= MAX_DEVICES) return undefined
    const entry: Entry = { id: randomBytes(6).toString('hex'), key: newSecret() }
    store.devices.push({ id: entry.id, name, key: sha256(entry.key), added: new Date(now).toISOString() })
    return entry
  })
}

/** Whether `entry` is a device that is in. */
export function isIn(store: Store, entry: Entry): boolean {
  const device = store.devices.find(candidate => candidate.id === entry.id)
  return device !== undefined && sameDigest(device.key, sha256(entry.key))
}

/** Take a device out; false when no device has that id. */
export async function removeDevice(env: NodeJS.ProcessEnv, id: string): Promise<boolean> {
  return update(env, store => {
    const kept = store.devices.filter(device => device.id !== id)
    const removed = kept.length !== store.devices.length
    store.devices = kept
    return removed
  })
}

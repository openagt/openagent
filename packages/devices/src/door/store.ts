import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, join } from 'node:path'

/**
 * The door's own file, in the person's home folder: whether the door is open, the devices that
 * are in, the codes waiting to be scanned, and where the door listens while it does. The command
 * and the door's process both write it, so every change goes through {@link update}.
 *
 * A device's key and a code are kept as their SHA-256 only: the file never holds what would let
 * someone in here. It does hold the key this computer has at a server it keeps a line open to,
 * as it is: the line is asked for with it. So the file is the person's alone to read.
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
  /**
   * Set for a computer that got in to keep a line open here: the port on this server where its
   * OpenAgent is asked through that line. Its own from the day it got in, so the address
   * OpenAgent saved it under stays good.
   *
   * A computer whose line is for everyone here has an address for each other person too
   * (`others`, by their GitHub account, the owner's among them): each in the block of ports of
   * that person's own OpenAgent, which asks it there. An empty `others` is a line for everyone on
   * a computer that has nobody else yet.
   */
  line?: { port: number; others?: Record<string, number> }
  /**
   * Which computer the entry is: the SHA-256 of the word that computer says, hex. Its OpenAgent
   * and its line say the same word, so a computer is listed once, and one that gets in again
   * takes the place of what it had. Kept as a key is: the file never holds what would let someone
   * else say it. Absent for a phone or a browser, and for a computer that never said.
   */
  computer?: string
  /** The person the device is theirs, by their GitHub account; absent for the owner's. */
  person?: string
}

/**
 * A person on this computer: their GitHub account. The owner is named once, the first time a
 * device is let in for someone else; until then the computer has no persons and every device is
 * the owner's, as on a computer one person uses.
 */
export interface Person {
  /** Their GitHub account, in small letters. */
  account: string
  /** The computer's owner: the one who invites. */
  owner?: true
  /** ISO 8601. */
  added: string
  /**
   * On a computer that gives each person a user of their own: the first port of their block,
   * where their own OpenAgent listens. The door passes their calls there, and their computers'
   * lines are given ports in the same block. Never the owner's: the owner's OpenAgent is the one
   * that started this door. Absent on a computer with no users per person, where every call goes
   * to the one OpenAgent, as before.
   */
  port?: number
  /** Their user and their OpenAgent are made: the helper said so. */
  ready?: true
  /** Why their user could not be made, in the helper's last words: asked again, it is tried again. */
  problem?: string
  /** The process that makes their user right now. */
  worker?: number
  /**
   * The server whose line made them here, by its door: a person there who started a run on this
   * computer, which that server's line lets everyone there do. Absent for one invited here.
   */
  from?: string
  /** The owner keeps them, though the server they came from no longer has them: nobody is asked about them again. */
  kept?: true
}

/**
 * The ports a person's own OpenAgent is given, one block of a hundred each: the first port of a
 * block is their OpenAgent's. The owner's block is the one OpenAgent's own port starts.
 */
export const PERSON_PORTS = { from: 4300, step: 100, last: 9900 } as const

/** Where a person's computers' lines are in their block: a short way after their OpenAgent, as the owner's are after the owner's. */
export const PERSON_LINES = { offset: 10, count: 50 } as const

/** The ports the lines of a person's computers are given, in the block that starts at `port`. */
export function personLinePorts(port: number): { from: number; count: number } {
  return { from: port + PERSON_LINES.offset, count: PERSON_LINES.count }
}

/** Every port a device's line has here: its own, and those it has for the other persons. */
export function portsOf(device: Device): number[] {
  return device.line ? [device.line.port, ...Object.values(device.line.others ?? {})] : []
}

/**
 * Give a computer whose line is for everyone an address for each person here who is not its own:
 * one among the lines' ports of that person's own OpenAgent, the owner's in `ownerPorts`. A person
 * with no OpenAgent of their own is asked through the owner's, and has no address of their own. A
 * port given is kept for as long as the person is here; a person gone loses theirs. Answers
 * whether anything changed.
 */
export function shareLine(store: Store, device: Device, ownerPorts: { from: number; count: number }): boolean {
  if (!device.line) return false
  const own = personOf(store, device)
  const had = device.line.others ?? {}
  const taken = new Set(store.devices.filter(other => other !== device).flatMap(portsOf))
  taken.add(device.line.port)
  const others: Record<string, number> = {}
  for (const person of store.persons) {
    if (person.account === own || (!person.owner && person.port === undefined)) continue
    const block = person.owner ? ownerPorts : personLinePorts(person.port!)
    const kept = had[person.account]
    const port = kept !== undefined && kept >= block.from && kept < block.from + block.count && !taken.has(kept) ? kept : Array.from({ length: block.count }, (_, at) => block.from + at).find(candidate => !taken.has(candidate))
    if (port === undefined) continue
    taken.add(port)
    others[person.account] = port
  }
  const same = device.line.others !== undefined && JSON.stringify(Object.entries(others).sort()) === JSON.stringify(Object.entries(had).sort())
  device.line.others = others
  return !same
}

/**
 * A person's own OpenAgent, by the port their block starts at: `undefined` for the owner, for
 * nobody, and on a computer with no users per person. A person whose user is still being made
 * has it already: their calls get no answer until their OpenAgent is up, and never the owner's.
 */
export function portOf(store: Store, account: string | undefined): number | undefined {
  return account === undefined ? undefined : store.persons.find(person => person.account === account && !person.owner)?.port
}

/** What a GitHub account is: letters, digits and single dashes, at most 39, not starting or ending with a dash. */
export function accountOf(said: string): string | undefined {
  const account = said.trim().replace(/^@/, '').toLowerCase()
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/.test(account) ? account : undefined
}

/**
 * How the door tells OpenAgent who a call is from: the person's GitHub account. The door sets it
 * on every call it passes on, and takes it off any request that brings one of its own.
 */
export const PERSON_HEADER = 'x-openagent-person'

/**
 * How a computer says which one it is, when it gets in and with every call it makes with its
 * key: the same word from its OpenAgent and from its line, so it is listed once here.
 */
export const COMPUTER_HEADER = 'x-openagent-computer'

/** What a computer says it is: a word of its own making, the same for all that gets in from it. */
export const isComputerId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]{16,64}$/.test(value)

/**
 * The word a computer says to one door, made from the word it keeps and that door's address: each
 * door hears another word, so one that a door learned says nothing at any other door. OpenAgent
 * makes the same word for the calls it sends that door itself.
 */
export function computerWordFor(word: string, door: string): string {
  return createHmac('sha256', word).update(new URL(door).origin).digest('hex').slice(0, 32)
}

/** A server this computer keeps a line open to, so the server can ask this computer's OpenAgent things. */
export interface Line {
  /** The server's door, as an origin: `https://203.0.113.7`. */
  url: string
  /** What the server's key is known by: the line is asked for only of a server that shows that key. */
  pin: string
  /** This computer's id and key there, as one word. */
  key: string
  /** What the server may do through the line: everything a machine is asked, or only what reads. */
  mode: 'full' | 'watch'
  /**
   * Who on the server may start runs here through the line: everyone there, each as a user of
   * their own on this computer. Absent: only this computer's own person.
   */
  for?: 'everyone'
  /** This computer's person at the server, by their GitHub account, as its door said. */
  account?: string
  /** For a line for everyone: the server's persons, as its door last said them. */
  persons?: string[]
  /** The server said no to this computer's key when the line was last asked for: nothing changes that but the person. */
  refused?: true
}

/** A code a new device gets in with, once. */
export interface Code {
  /** The SHA-256 of the code, hex. */
  code: string
  /** ISO 8601. */
  expires: string
  /** The person the device that gets in with it is for; absent for the owner's own. */
  person?: string
  /**
   * Made for a computer of that person to keep a line with, by a computer of theirs that is in:
   * it lets in nothing else, neither a browser nor a computer that gets in for OpenAgent alone.
   */
  line?: true
}

/** Where the door listens, written by its process while it does. */
export interface Listening {
  pid: number
  port: number
}

/** The door on a server: open to every network, over HTTPS, at the address the server is reached at. */
export interface Https {
  /** The server's number or name, as a browser types it. */
  address: string
}

export interface Store {
  /** The "On this Wi-Fi" switch. */
  on: boolean
  /** Set on a server: the door is always open there, and the switch is not looked at. */
  https?: Https
  /** The persons on this computer, the owner first; none until the owner is named. */
  persons: Person[]
  devices: Device[]
  codes: Code[]
  /** The servers this computer keeps a line open to. */
  lines: Line[]
  listening?: Listening
  /** Why the door is not listening although it should, in words; on a server also why its certificate could not be renewed. */
  problem?: string
}

/** How long a code is good for. */
export const CODE_LIFETIME_MS = 5 * 60 * 1000
/** Caps, so a file edited by hand or a flood of scans cannot bloat it. */
export const MAX_DEVICES = 50
export const MAX_CODES = 20
export const MAX_LINES = 20
export const MAX_PERSONS = 50
const MAX_NAME = 80
const MAX_PROBLEM = 400

const FILE = 'openagent-devices.json'

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

/**
 * A server's number or name as the file keeps it: what a certificate can be for, written the one
 * way a certificate office and a link both read it. A name in small letters; an IPv6 number in
 * its short form, with no zone and no IPv4 tail.
 */
export const isAddress = (value: unknown): value is string => typeof value === 'string' && addressOf(value) === value

/** `said` as the file keeps an address, or `undefined` for what is no server's number or name. */
export function addressOf(said: string): string | undefined {
  if (said.length > 253) return undefined
  if (isIP(said) === 4) return said
  if (isIP(said) === 6) {
    if (said.includes('%') || said.includes('.')) return undefined
    return new URL(`http://[${said}]`).hostname.slice(1, -1)
  }
  return /^(?=.*[a-z])[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(said) ? said.toLowerCase() : undefined
}

const isIso = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const isAccount = (value: unknown): value is string => typeof value === 'string' && accountOf(value) === value
const isPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536
/** A server's door as a line is kept under: an HTTPS origin, written the one way. */
export function isLineUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value
  } catch {
    return false
  }
}

/** Read what a file holds, forgivingly: anything malformed is left out, never a reason to fail. */
export function sanitize(value: unknown): Store {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const persons: Person[] = []
  for (const entry of Array.isArray(obj.persons) ? obj.persons : []) {
    if (persons.length >= MAX_PERSONS) break
    if (!entry || typeof entry !== 'object') continue
    const { account, owner, added, port, ready, problem, worker, from, kept } = entry as Record<string, unknown>
    if (!isAccount(account) || !isIso(added) || persons.some(person => person.account === account)) continue
    const came = { ...(isLineUrl(from) ? { from } : {}), ...(kept === true ? { kept: true as const } : {}) }
    // One owner, listed first.
    if (owner === true && !persons.some(person => person.owner)) persons.unshift({ account, owner: true, added })
    // One block for one person: a second person that names a port already given has none, and no user to make.
    else if (isPort(port) && !persons.some(person => person.port === port))
      persons.push({ account, added, port, ...(ready === true ? { ready: true as const } : {}), ...(typeof problem === 'string' && problem.trim() ? { problem: problem.trim().slice(0, MAX_PROBLEM) } : {}), ...(Number.isInteger(worker) && (worker as number) > 0 ? { worker: worker as number } : {}), ...came })
    else persons.push({ account, added, ...came })
  }
  // Persons with no owner are no persons: the owner is named first, then the others.
  if (!persons[0]?.owner) persons.length = 0
  // A device or a code for someone who is not among the persons, or for the owner, is the owner's.
  const someoneElse = (said: unknown): string | undefined => (isAccount(said) && persons.some(person => person.account === said && !person.owner) ? said : undefined)
  const devices: Device[] = []
  // Every port a line has here, its own and those it has for others: one port is one address.
  const taken = new Set<number>()
  for (const entry of Array.isArray(obj.devices) ? obj.devices : []) {
    if (devices.length >= MAX_DEVICES) break
    if (!entry || typeof entry !== 'object') continue
    const { id, name, key, added, seen, line, computer, person } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !/^[a-z0-9]{6,32}$/.test(id) || !isDigest(key) || !isIso(added)) continue
    if (devices.some(device => device.id === id)) continue
    const { port, others } = (line && typeof line === 'object' ? line : {}) as Record<string, unknown>
    // One port for one computer: a second entry that names a port already given is in without a line.
    const own = isPort(port) && !taken.has(port)
    if (own) taken.add(port)
    const whose = someoneElse(person)
    // Its addresses for others: each for a person here who is not its own, at a port nobody else has.
    let shared: Record<string, number> | undefined
    if (own && others && typeof others === 'object' && !Array.isArray(others)) {
      shared = {}
      for (const [account, at] of Object.entries(others as Record<string, unknown>)) {
        if (!isAccount(account) || !isPort(at) || taken.has(at) || account === (whose ?? persons[0]?.account) || !persons.some(candidate => candidate.account === account)) continue
        taken.add(at)
        shared[account] = at
      }
    }
    devices.push({ id, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME) : 'A device', key, added, ...(isIso(seen) ? { seen } : {}), ...(own ? { line: { port, ...(shared ? { others: shared } : {}) } } : {}), ...(isDigest(computer) ? { computer } : {}), ...(whose ? { person: whose } : {}) })
  }
  const lines: Line[] = []
  for (const entry of Array.isArray(obj.lines) ? obj.lines : []) {
    if (lines.length >= MAX_LINES) break
    if (!entry || typeof entry !== 'object') continue
    const { url, pin, key, mode, refused, for: who, account, persons: theirs } = entry as Record<string, unknown>
    if (!isLineUrl(url) || typeof pin !== 'string' || !pin || typeof key !== 'string' || !key) continue
    if (lines.some(line => line.url === url)) continue
    const everyone = who === 'everyone'
    const heard = everyone && Array.isArray(theirs) ? [...new Set(theirs.filter(isAccount))].slice(0, MAX_PERSONS) : undefined
    lines.push({ url, pin, key, mode: mode === 'watch' ? 'watch' : 'full', ...(everyone ? { for: 'everyone' as const } : {}), ...(isAccount(account) ? { account } : {}), ...(heard ? { persons: heard } : {}), ...(refused === true ? { refused: true } : {}) })
  }
  const codes: Code[] = []
  for (const entry of Array.isArray(obj.codes) ? obj.codes : []) {
    if (!entry || typeof entry !== 'object') continue
    const { code, expires, person, line } = entry as Record<string, unknown>
    if (isDigest(code) && isIso(expires)) codes.push({ code, expires, ...(someoneElse(person) ? { person: person as string } : {}), ...(line === true ? { line: true as const } : {}) })
  }
  const listening = obj.listening && typeof obj.listening === 'object' ? (obj.listening as Record<string, unknown>) : undefined
  const https = obj.https && typeof obj.https === 'object' ? (obj.https as Record<string, unknown>).address : undefined
  return {
    on: obj.on === true,
    ...(isAddress(https) ? { https: { address: https } } : {}),
    persons,
    devices,
    codes: codes.slice(-MAX_CODES),
    lines,
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

/**
 * Make a code a new device gets in with; answers the code itself, which the file does not keep.
 * With `person`, the device is that person's: one of the persons, not the owner. With `line`, it
 * lets in a computer that keeps a line, and nothing else.
 */
export async function addCode(env: NodeJS.ProcessEnv, now = Date.now(), person?: string, line = false): Promise<{ code: string; expires: string }> {
  // Half the length of a device's key: it lives five minutes and works once, and a shorter link is a QR code a camera reads more easily.
  const code = randomBytes(16).toString('base64url')
  const expires = new Date(now + CODE_LIFETIME_MS).toISOString()
  await update(env, store => {
    store.codes = [...liveCodes(store.codes, now), { code: sha256(code), expires, ...(person !== undefined ? { person } : {}), ...(line ? { line: true as const } : {}) }].slice(-MAX_CODES)
  })
  return { code, expires }
}

/** What a device holds once it is in: its id and its key, as the cookie carries them. */
export interface Entry {
  id: string
  key: string
}

/** A device let in: what it holds, and whose it is when it is not the owner's. */
export interface Entered extends Entry {
  person?: string
}

/**
 * Let a new device in with `code`: the code is spent, the device is saved, and its key is
 * answered once. `undefined` for a code that is unknown, spent or too old, and when the list is full.
 *
 * A computer that says which one it is (`computer`, the SHA-256 of the word it said) takes the
 * place of what it had here before of the same kind, its key for OpenAgent or its line: it is
 * not listed a second time, and a line keeps the port it had, so the address OpenAgent saved the
 * computer under stays good.
 *
 * `line` holds the ports of the owner's lines. A computer of a person with an OpenAgent of their
 * own gets its line's port in that person's block instead, where their OpenAgent asks it. A code
 * made for a line lets in nothing but a line, and is not spent by what it does not let in.
 */
export async function enter(env: NodeJS.ProcessEnv, code: string, name: string, now = Date.now(), line?: { from: number; count: number }, computer?: string): Promise<Entered | undefined> {
  const digest = sha256(code)
  // Looked up before the file is locked: a flood of wrong codes from the network changes nothing and holds no writer up.
  if (!liveCodes((await readStore(env)).codes, now).some(candidate => sameDigest(candidate.code, digest))) return undefined
  return update(env, store => {
    const live = liveCodes(store.codes, now)
    const match = live.find(candidate => sameDigest(candidate.code, digest))
    if (match?.line && !line) return undefined
    store.codes = live.filter(candidate => candidate !== match)
    if (!match) return undefined
    // What this computer had here before, of the same kind: the new entry is in its place.
    const before = computer === undefined ? [] : store.devices.filter(device => device.computer === computer && (device.line !== undefined) === (line !== undefined))
    const others = store.devices.filter(device => !before.includes(device))
    if (others.length >= MAX_DEVICES) return undefined
    // A computer that got in for a line gets the port it had, or the first of the lines' ports no other computer has.
    const own = portOf(store, match.person)
    const ports = line && (own !== undefined ? personLinePorts(own) : line)
    const taken = new Set(others.flatMap(portsOf))
    const had = before.find(device => device.line !== undefined)?.line?.port
    const port = ports && (had !== undefined && had >= ports.from && had < ports.from + ports.count ? had : Array.from({ length: ports.count }, (_, at) => ports.from + at).find(candidate => !taken.has(candidate)))
    if (ports && port === undefined) return undefined
    const entry: Entered = { id: randomBytes(6).toString('hex'), key: newSecret(), ...(match.person !== undefined ? { person: match.person } : {}) }
    store.devices = [...others, { id: entry.id, name, key: sha256(entry.key), added: new Date(now).toISOString(), ...(port !== undefined ? { line: { port } } : {}), ...(computer !== undefined ? { computer } : {}), ...(match.person !== undefined ? { person: match.person } : {}) }]
    return entry
  })
}

/** Whether `entry` is a device that is in. */
export function isIn(store: Store, entry: Entry): boolean {
  const device = store.devices.find(candidate => candidate.id === entry.id)
  return device !== undefined && sameDigest(device.key, sha256(entry.key))
}

/**
 * Take a computer out, by the id of either entry it has here: its key for OpenAgent and its line
 * go together, as the list shows them as one row. Exactly what that row holds: the entry, and
 * the first of the other kind that says it is the same computer. A phone or a browser, and a
 * computer that never said which one it is, is the one entry. False when no device has that id.
 *
 * With `whose`, only a device of that person is taken out, and its other entry only when that is
 * theirs too: what a person's own device asks for. `whose.person` is `undefined` on a computer
 * with no persons, where every device is the one person's.
 */
export async function removeComputer(env: NodeJS.ProcessEnv, id: string, whose?: { person: string | undefined }): Promise<boolean> {
  return update(env, store => {
    const theirs = (device: Device): boolean => whose === undefined || personOf(store, device) === whose.person
    const named = store.devices.find(device => device.id === id && theirs(device))
    if (!named) return false
    const partner = named.computer === undefined ? undefined : store.devices.find(device => device !== named && theirs(device) && device.computer === named.computer && (device.line !== undefined) !== (named.line !== undefined))
    store.devices = store.devices.filter(device => device !== named && device !== partner)
    return true
  })
}

/** Give a device the name the person picked: a computer under both its entries. False when no device has that id, or the name is empty. */
export async function renameComputer(env: NodeJS.ProcessEnv, id: string, name: string): Promise<boolean> {
  const picked = name.trim().slice(0, MAX_NAME)
  if (!picked) return false
  return update(env, store => {
    const named = store.devices.find(device => device.id === id)
    if (!named) return false
    for (const device of store.devices) if (device === named || (named.computer !== undefined && device.computer === named.computer && device.person === named.person)) device.name = picked
    return true
  })
}

/** Take one entry out, and no other: what a device does when it takes itself out. False when no device has that id. */
export async function removeDevice(env: NodeJS.ProcessEnv, id: string): Promise<boolean> {
  return update(env, store => {
    const kept = store.devices.filter(device => device.id !== id)
    const removed = kept.length !== store.devices.length
    store.devices = kept
    return removed
  })
}

/** Whose a device is, by its GitHub account: its person's, else the owner's; `undefined` while no owner is named. */
export function personOf(store: Store, device: Device): string | undefined {
  return device.person ?? store.persons.find(person => person.owner)?.account
}

/**
 * Name the computer's owner, once: the devices already in are theirs. False when another owner
 * is named already, or when the account is one of the persons invited here.
 */
export async function nameOwner(env: NodeJS.ProcessEnv, account: string, now = Date.now()): Promise<boolean> {
  return update(env, store => {
    const owner = store.persons.find(person => person.owner)
    if (owner) return owner.account === account
    store.persons = [{ account, owner: true, added: new Date(now).toISOString() }]
    return true
  })
}

/**
 * Put a person among the persons, when they are not yet: the owner must be named first. With
 * `withPort`, on a computer that gives each person a user of their own, the person gets the first
 * block of ports no other person has, and keeps it. Answers the person as the file keeps them;
 * `undefined` when the owner is not named, the list is full, or no block is free.
 */
export async function addPerson(env: NodeJS.ProcessEnv, account: string, now = Date.now(), withPort = false): Promise<Person | undefined> {
  return update(env, store => {
    if (!store.persons[0]?.owner) return undefined
    const known = store.persons.find(person => person.account === account)
    if (known && (known.owner || !withPort || known.port !== undefined)) return { ...known }
    const port = withPort ? freeBlock(store) : undefined
    if (withPort && port === undefined) return undefined
    if (known) {
      if (port !== undefined) known.port = port
      return { ...known }
    }
    if (store.persons.length >= MAX_PERSONS) return undefined
    const person: Person = { account, added: new Date(now).toISOString(), ...(port !== undefined ? { port } : {}) }
    store.persons = [...store.persons, person]
    return { ...person }
  })
}

/** The first block of ports no person has. */
function freeBlock(store: Store): number | undefined {
  const taken = new Set(store.persons.map(person => person.port))
  for (let port: number = PERSON_PORTS.from; port <= PERSON_PORTS.last; port += PERSON_PORTS.step) if (!taken.has(port)) return port
  return undefined
}

/** Take a person out, with every device of theirs and every code made for them. False for the owner and for no such person. */
export async function removePerson(env: NodeJS.ProcessEnv, account: string): Promise<boolean> {
  return update(env, store => {
    const person = store.persons.find(candidate => candidate.account === account)
    if (!person || person.owner) return false
    store.persons = store.persons.filter(candidate => candidate !== person)
    store.devices = store.devices.filter(device => device.person !== account)
    store.codes = store.codes.filter(code => code.person !== account)
    return true
  })
}

/** A device as a person reads the list: a computer is one row, whatever it holds here. */
export interface ListedDevice {
  id: string
  name: string
  added: string
  seen?: string
  /** A computer that keeps a line open here. */
  line?: true
  /** The ids of what else the computer holds here, beside the row's own. */
  also?: string[]
  /** Whose device it is, by their GitHub account, once the computer has persons. */
  person?: string
}

/**
 * The devices as a person reads them: a computer is one row, its key for OpenAgent and its line
 * together. The row is the first entry's; the line's name is the computer's own, and when it was
 * added and last seen are the earliest and the latest of the two. Never more than one of each
 * kind in a row: every other key is a row of its own, so the list names every key that is in.
 */
export function listedDevices(store: Store): ListedDevice[] {
  const rows: (ListedDevice & { computer?: string; kinds: boolean[] })[] = []
  for (const device of store.devices) {
    const { id, name, added, seen, line, computer } = device
    const person = personOf(store, device)
    const isLine = line !== undefined
    // One computer's two entries are one row only when they are the same person's.
    const row = computer !== undefined ? rows.find(candidate => candidate.computer === computer && candidate.person === person && !candidate.kinds.includes(isLine)) : undefined
    if (!row) {
      rows.push({ id, name, added, ...(seen ? { seen } : {}), ...(line ? { line: true as const } : {}), ...(computer !== undefined ? { computer } : {}), ...(person !== undefined ? { person } : {}), kinds: [isLine] })
      continue
    }
    row.kinds.push(isLine)
    row.also = [...(row.also ?? []), id]
    if (added < row.added) row.added = added
    if (seen && (row.seen === undefined || seen > row.seen)) row.seen = seen
    if (line) {
      row.line = true
      row.name = name
    }
  }
  // Which computer an entry says it is stays in the file: a page that knew it could say it too.
  return rows.map(({ computer: _computer, kinds: _kinds, ...row }) => row)
}

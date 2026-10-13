import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, join } from 'node:path'
import { STEP_IDS, type StepId } from './steps.js'

/**
 * The servers this computer installed OpenAgent on, in the person's home folder: where each is,
 * who logs in there, and how far its install got. The command and the install's own process both
 * write it, so every change goes through {@link update}.
 *
 * It holds no key, no password and no login: the way in is this computer's own SSH keys, the key
 * the server's door gives is OpenAgent's, kept with its machines, and a GitHub or Claude login
 * goes to the server and is not kept here.
 */

export type StepState = 'waiting' | 'running' | 'done' | 'failed'

export interface Step {
  id: StepId
  state: StepState
  /** For a step that failed: what the server said, its last lines. */
  said?: string
}

/** The install's own process. */
export interface Worker {
  pid: number
  /** ISO 8601: written again every few seconds for as long as the process works. */
  seen: string
}

/** The two logins a server works with. */
export const LOGIN_KINDS = ['github', 'claude'] as const
export type LoginKind = (typeof LOGIN_KINDS)[number]

/**
 * One login of a server, as this computer left it. The login itself is never kept here: only
 * that it was put there, when, and for GitHub whose it is.
 */
export interface Login {
  /** ISO 8601: when this computer put the login on the server. Absent while the server has none from here. */
  since?: string
  /** GitHub: the account, as the server's own `gh` answered. */
  account?: string
  /** GitHub: to be copied once the install's steps are done. */
  wanted?: boolean
  /** Why the last try ended without a login. */
  failed?: string
  /** The process that changes the login right now, and when it last said it still does. */
  worker?: Worker
  /** That process waits for the person: for a yes in this computer's browser (Claude), or for a code typed at GitHub. */
  asking?: boolean
  /** GitHub: the code the person types at github.com/login/device while the server waits for it. It is no login: it says which waiting server a person's yes is for. */
  code?: string
}

export interface Server {
  /** The server's number or name: what a person typed, and what its certificate is for. */
  address: string
  /** Who logs in over SSH: `root`, or a user that becomes root without a password. */
  user: string
  /** What the server's key is known by, as SSH showed it when this computer first met it. */
  fingerprint?: string
  steps: Step[]
  /** The process that installs right now, and when it last said it still does. */
  worker?: Worker
  /** The install was asked for and the server is not among the machines yet: the page adds it once the steps are done. */
  adding: boolean
  /** The GitHub login this computer copied to the server. */
  github?: Login
  /** The Claude login this computer made for the server. */
  claude?: Login
  /**
   * Set once this computer keeps a line open to the server, so a run can be started here from
   * the server's page: what the server may do through it, everything or only read.
   */
  reach?: Reach
}

export type Reach = 'full' | 'watch'

export interface Store {
  servers: Server[]
}

/** A cap, so a file edited by hand cannot bloat it. */
export const MAX_SERVERS = 50
const MAX_SAID = 4_000

const FILE = 'openagent-servers.json'

/** The file's path: beside OpenAgent's own home file, by the same rule. */
export function storePath(env: NodeJS.ProcessEnv): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, FILE)
  return join(env.HOME ?? '', '.' + FILE)
}

/**
 * `said` as a server's address is kept, or `undefined` for what is none: a number, or a name, in
 * the one form the server's door keeps it in too, so the two always read the same. Nothing that
 * could be read as an option of a command passes.
 */
export function addressOf(said: string): string | undefined {
  if (said.length > 253) return undefined
  if (isIP(said) === 4) return said
  if (isIP(said) === 6) {
    if (said.includes('%') || said.includes('.')) return undefined
    return new URL(`http://[${said}]`).hostname.slice(1, -1)
  }
  return /^(?=.*[a-z])[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(said) ? said.toLowerCase() : undefined
}

/** Whether `said` is a user name a Linux server has. */
export const isUser = (said: unknown): said is string => typeof said === 'string' && /^[a-z_][a-z0-9_-]{0,31}$/.test(said)

/** Whether `said` is a version npm keeps a package under. */
export const isVersion = (said: unknown): said is string => typeof said === 'string' && said.length <= 64 && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(said)

/** Whether `said` reads as the code GitHub gives a device to show: two groups of four. */
export const isGithubCode = (said: unknown): said is string => typeof said === 'string' && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(said)

/** How often the install's process says it still works, and after how long of silence it is taken for gone. */
export const BEAT_MS = 10_000
export const SILENT_MS = 45_000

/**
 * Say again and again that a work is alive: `beat` every `everyMs`, one at a time, a failed one
 * left at that. `stop` ends it and waits for the one on its way: a beat changes the file, and
 * one that landed after the work's own last word would write when the work has ended.
 */
export function heartbeat(beat: () => Promise<unknown>, everyMs: number): { stop(): Promise<void> } {
  let onItsWay: Promise<void> | undefined
  const timer = setInterval(() => {
    onItsWay ??= Promise.resolve()
      .then(beat)
      .catch(() => {})
      .then(() => void (onItsWay = undefined))
  }, everyMs)
  return {
    stop: async () => {
      clearInterval(timer)
      await onItsWay
    },
  }
}

/**
 * Whether the server's install runs right now: its process is there, and said so a moment ago.
 * The process's number alone is no proof: one that died without a word (a laptop that was
 * switched off) leaves its number in the file, and the system gives it to another program later.
 */
export function working(server: Server, now = Date.now()): boolean {
  return atWork(server.worker, now)
}

/** Whether a process that wrote itself to the file is still at work: it is there, and said so a moment ago. */
export function atWork(worker: Worker | undefined, now = Date.now()): boolean {
  return worker !== undefined && pidAlive(worker.pid) && now - Date.parse(worker.seen) < SILENT_MS
}

/** Whether `said` is a GitHub account's name. */
export const isAccount = (said: unknown): said is string => typeof said === 'string' && /^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/.test(said)

/** Where the door of the server at `address` answers: what OpenAgent's machines know it by. */
export function doorUrl(address: string): string {
  return `https://${address.includes(':') ? `[${address}]` : address}`
}

/** Every step, not started. */
export const freshSteps = (): Step[] => STEP_IDS.map(id => ({ id, state: 'waiting' }))

const STATES: readonly StepState[] = ['waiting', 'running', 'done', 'failed']

function readWorker(value: unknown): { worker: Worker } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { pid, seen } = value as Record<string, unknown>
  return Number.isInteger(pid) && (pid as number) > 0 && typeof seen === 'string' && !Number.isNaN(Date.parse(seen)) ? { worker: { pid: pid as number, seen } } : undefined
}

function readLogin(value: unknown): Login | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { since, account, wanted, failed, worker, asking, code } = value as Record<string, unknown>
  const login: Login = {
    ...(typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? { since } : {}),
    ...(isAccount(account) ? { account } : {}),
    ...(wanted === true ? { wanted } : {}),
    ...(typeof failed === 'string' && failed ? { failed: failed.slice(-MAX_SAID) } : {}),
    ...(readWorker(worker) ?? {}),
    ...(asking === true ? { asking } : {}),
    ...(isGithubCode(code) ? { code } : {}),
  }
  return Object.keys(login).length ? login : undefined
}

/** Read what a file holds, forgivingly: anything malformed is left out, never a reason to fail. */
export function sanitize(value: unknown): Store {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const servers: Server[] = []
  for (const entry of Array.isArray(obj.servers) ? obj.servers : []) {
    if (servers.length >= MAX_SERVERS) break
    if (!entry || typeof entry !== 'object') continue
    const { address, user, fingerprint, steps, worker, adding, github, claude, reach } = entry as Record<string, unknown>
    const [githubLogin, claudeLogin] = [readLogin(github), readLogin(claude)]
    if (typeof address !== 'string' || addressOf(address) !== address || !isUser(user)) continue
    if (servers.some(server => server.address === address)) continue
    // Every step, in the install's own order: a step the file does not know has not started.
    const known = new Map<string, Step>()
    for (const step of Array.isArray(steps) ? steps : []) {
      if (!step || typeof step !== 'object') continue
      const { id, state, said } = step as Record<string, unknown>
      if (typeof id !== 'string' || !STATES.includes(state as StepState)) continue
      known.set(id, { id: id as StepId, state: state as StepState, ...(typeof said === 'string' && said ? { said: said.slice(-MAX_SAID) } : {}) })
    }
    servers.push({
      address,
      user,
      ...(typeof fingerprint === 'string' && /^SHA256:[A-Za-z0-9+/=]{20,64}$/.test(fingerprint) ? { fingerprint } : {}),
      steps: STEP_IDS.map(id => known.get(id) ?? { id, state: 'waiting' }),
      ...(readWorker(worker) ?? {}),
      adding: adding === true,
      ...(reach === 'full' || reach === 'watch' ? { reach } : {}),
      ...(githubLogin ? { github: githubLogin } : {}),
      ...(claudeLogin ? { claude: claudeLogin } : {}),
    })
  }
  return { servers }
}

/** The file is there and cannot be read as what it should hold: a typo made by hand, a disk that failed. */
export class Unreadable extends Error {
  constructor(path: string) {
    super(`${path} cannot be read: correct it, or delete it to start with no server`)
  }
}

/** The file as it stands; no file reads as no server. Throws {@link Unreadable} for a file that is there and cannot be read. */
export async function readStore(env: NodeJS.ProcessEnv): Promise<Store> {
  const path = storePath(env)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return sanitize(undefined)
    throw new Unreadable(path)
  }
  try {
    const value: unknown = JSON.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) return sanitize(value)
  } catch {
    // Told below, as any file that holds something else.
  }
  throw new Unreadable(path)
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
      else if (Date.now() > deadline) throw new Error('the servers file is held by another writer')
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
 * `change` answers what the caller wants to know of the change.
 */
export async function update<T>(env: NodeJS.ProcessEnv, change: (store: Store) => T): Promise<T> {
  const path = storePath(env)
  return withLock(path, async () => {
    const store = await readStore(env)
    const answer = change(store)
    const tmp = `${path}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(sanitize(store), null, 2) + '\n', { mode: 0o600 })
    await rename(tmp, path)
    return answer
  })
}

/** Change the one server at `address`, when the file still holds it; answers what `apply` did, or `undefined` for a server that is gone. */
export function changeServer<T>(env: NodeJS.ProcessEnv, address: string, apply: (server: Server) => T): Promise<T | undefined> {
  return update(env, store => {
    const kept = store.servers.find(candidate => candidate.address === address)
    return kept ? apply(kept) : undefined
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

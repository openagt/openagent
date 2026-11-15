import { readFile } from 'node:fs/promises'
import { isAddress, isLineUrl, urlHost } from '../door/address.js'
import { VIA_PREFIX } from '../door/paths.js'
import { nameOf } from '../door/names.js'
import { Unreadable, homeFile, jsonFile, withLock, writeWhole } from '../home-file.js'
import { pidAlive } from '../process.js'
import { reachedOf, stepIdsFor, type Reached, type StepId, type Who } from './steps.js'

/**
 * The servers this computer installed OpenAgent on, in the person's home folder: where each is,
 * who logs in there, and how far its install got. The command and the install's own process both
 * write it, so every change goes through {@link update}.
 *
 * It holds no key, no password and no login: the way in is this computer's own SSH keys, the key
 * the server's door gives is OpenAgent's, kept with its machines, and a login handed on from here
 * is not kept here.
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

/** The two logins a person's own OpenAgent works with. */
export const LOGIN_KINDS = ['github', 'claude'] as const
export type LoginKind = (typeof LOGIN_KINDS)[number]

/**
 * One login, as this computer left it: one of this OpenAgent's own, or one it makes for another
 * person's computer. The login itself is never kept here: only that it was put there, when, and
 * for GitHub whose it is.
 */
export interface Login {
  /** ISO 8601: when the login was put there. Absent while there is none. */
  since?: string
  /** GitHub: the account, as `gh` answered. */
  account?: string
  /** Why the last try ended without a login. */
  failed?: string
  /** The process that changes the login right now, and when it last said it still does. */
  worker?: Worker
  /** That process waits for the person: for a yes in this computer's browser. */
  asking?: boolean
  /**
   * A login of this OpenAgent's own that another OpenAgent of the same person copied here: the
   * name of the server it came from. Absent for one the person made here themselves.
   */
  from?: string
  /** The start of the login's SHA-256: whoever copied it tells by it whether its own is still the same, and never learns the login from it. */
  mark?: string
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
  /**
   * Set once this computer keeps a line open to the server, so a run can be started here from
   * the server's page: what the server may do through it, everything or only read.
   */
  reach?: Reach
  /**
   * Set for a computer reached through a server, with no door of its own on the internet: that
   * server's door, as an origin, which the computer keeps its line to. A computer at home, say.
   */
  through?: string
  /** For a computer reached through a server: who there may start runs on it, as this computer last said. */
  who?: Who
  /** For a computer reached through a server: the people there who may start runs on it besides its owner, by name, as this computer last said. */
  people?: string[]
  /** For a computer reached through a server: the id its line has among that server's devices, once it is among OpenAgent's machines through it. */
  line?: string
  /** Set for a computer on the person's Tailscale network, connected by its name there: its door is there, behind Tailscale. */
  tailscale?: true
}

export type Reach = 'full' | 'watch'

/**
 * Another person's computer, shared with this computer's person on a server both are in at:
 * saved among OpenAgent's machines, by the address it answers at. What is kept here is only
 * what this computer does for it itself: the Claude login it makes in its browser for that
 * person's OpenAgent there, while it does.
 */
export interface Shared {
  /** The machine's address, as OpenAgent's machines know it. */
  url: string
  claude?: Login
}

export interface Store {
  servers: Server[]
  /** On a computer several people use, where this OpenAgent is one person's: the logins it was given for itself. */
  own?: { github?: Login; claude?: Login }
  shared: Shared[]
}

/** A cap, so a file edited by hand cannot bloat it. */
export const MAX_SERVERS = 50
const MAX_SAID = 4_000

/** Where who is in at each server is kept, as last listed: beside the servers' file, by the same rule. */
const keptDevicesPath = (env: NodeJS.ProcessEnv): string => homeFile(env, 'openagent-servers-devices.json')

async function readKeptDevices(env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  try {
    const said: unknown = JSON.parse(await readFile(keptDevicesPath(env), 'utf8'))
    return said && typeof said === 'object' && !Array.isArray(said) ? (said as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Who is in at the server at `address`, as last listed here: none when it was never listed. */
export async function keptDevices(env: NodeJS.ProcessEnv, address: string): Promise<unknown> {
  return (await readKeptDevices(env))[address]
}

/**
 * Keep who is in at the server at `address`, as just listed: the list comes over SSH, which takes
 * seconds, so a page shows the kept one at once while it asks again. Not in the servers' file: a
 * list read every few seconds is no change to a server. `said` undefined forgets it.
 */
export async function keepDevices(env: NodeJS.ProcessEnv, address: string, said: unknown): Promise<void> {
  const path = keptDevicesPath(env)
  await withLock(path, 'the servers file', async () => {
    const kept = await readKeptDevices(env)
    delete kept[address]
    if (said !== undefined) kept[address] = said
    await writeWhole(path, JSON.stringify(Object.fromEntries(Object.entries(kept).slice(-MAX_SERVERS))) + '\n')
  })
}

/** Whether `said` is a user name a Linux server has. */
export const isUser = (said: unknown): said is string => typeof said === 'string' && /^[a-z_][a-z0-9_-]{0,31}$/.test(said)

/** Whether `said` is a version npm keeps a package under. */
export const isVersion = (said: unknown): said is string => typeof said === 'string' && said.length <= 64 && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(said)

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
  return `https://${urlHost(address)}`
}

/** Every step, not started: a computer reached through a server has its line where a server has its door. */
export const freshSteps = (reached: Reached = 'internet'): Step[] => stepIdsFor(reached).map(id => ({ id, state: 'waiting' }))

/** Where a computer reached through a server is among OpenAgent's machines: through that server's door, down its line. */
export function throughUrl(server: Pick<Server, 'through' | 'line'>): string | undefined {
  return server.through !== undefined && server.line !== undefined ? `${server.through}${VIA_PREFIX}/${server.line}` : undefined
}

const WHO: readonly Who[] = ['nobody', 'me']

const STATES: readonly StepState[] = ['waiting', 'running', 'done', 'failed']

/** Names as a file says them: each once, and only what is a name. */
const named = (said: unknown): string[] => (Array.isArray(said) ? [...new Set(said.flatMap(name => (typeof name === 'string' && nameOf(name) === name ? [name] : [])))] : [])

function readWorker(value: unknown): { worker: Worker } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { pid, seen } = value as Record<string, unknown>
  return Number.isInteger(pid) && (pid as number) > 0 && typeof seen === 'string' && !Number.isNaN(Date.parse(seen)) ? { worker: { pid: pid as number, seen } } : undefined
}

/** A server's name as a copied login says where it came from: its host or its address, and nothing a page could not show. */
export const isServerName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.:\-[\]]{0,252}$/.test(value)

/** How long a login's mark is: enough to tell two logins apart, far too little to tell either. */
export const MARK_LENGTH = 16
const isMark = (value: unknown): value is string => typeof value === 'string' && new RegExp(`^[0-9a-f]{${MARK_LENGTH}}$`).test(value)

function readLogin(value: unknown): Login | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { since, account, failed, worker, asking, from, mark } = value as Record<string, unknown>
  const login: Login = {
    ...(typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? { since } : {}),
    ...(isAccount(account) ? { account } : {}),
    ...(typeof failed === 'string' && failed ? { failed: failed.slice(-MAX_SAID) } : {}),
    ...(readWorker(worker) ?? {}),
    ...(asking === true ? { asking } : {}),
    ...(isServerName(from) ? { from } : {}),
    ...(isMark(mark) ? { mark } : {}),
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
    const { address, user, fingerprint, steps, worker, adding, reach, through, who, people, line, tailscale } = entry as Record<string, unknown>
    if (!isAddress(address) || !isUser(user)) continue
    if (servers.some(server => server.address === address)) continue
    // Every step, in the install's own order: a step the file does not know has not started.
    const known = new Map<string, Step>()
    for (const step of Array.isArray(steps) ? steps : []) {
      if (!step || typeof step !== 'object') continue
      const { id, state, said } = step as Record<string, unknown>
      if (typeof id !== 'string' || !STATES.includes(state as StepState)) continue
      known.set(id, { id: id as StepId, state: state as StepState, ...(typeof said === 'string' && said ? { said: said.slice(-MAX_SAID) } : {}) })
    }
    // Only a server's door on the internet is one a computer keeps its line to.
    const via = isLineUrl(through) ? through : undefined
    // Only one connected by its name on Tailscale is one there.
    const onTailscale = via === undefined && tailscale === true && /\.ts\.net$/.test(address)
    servers.push({
      address,
      user,
      ...(typeof fingerprint === 'string' && /^SHA256:[A-Za-z0-9+/=]{20,64}$/.test(fingerprint) ? { fingerprint } : {}),
      steps: stepIdsFor(reachedOf({ ...(via !== undefined ? { through: via } : {}), ...(onTailscale ? { tailscale: true as const } : {}) })).map(id => known.get(id) ?? { id, state: 'waiting' }),
      ...(readWorker(worker) ?? {}),
      adding: adding === true,
      ...(reach === 'full' || reach === 'watch' ? { reach } : {}),
      ...(via !== undefined ? { through: via, ...(WHO.includes(who as Who) ? { who: who as Who } : {}), ...(named(people).length ? { people: named(people) } : {}), ...(typeof line === 'string' && /^[a-z0-9]{6,32}$/.test(line) ? { line } : {}) } : {}),
      ...(onTailscale ? { tailscale: true as const } : {}),
    })
  }
  const own: NonNullable<Store['own']> = {}
  const ownSaid = obj.own && typeof obj.own === 'object' ? (obj.own as Record<string, unknown>) : {}
  for (const kind of LOGIN_KINDS) {
    const login = readLogin(ownSaid[kind])
    if (login) own[kind] = login
  }
  const shared: Shared[] = []
  for (const entry of Array.isArray(obj.shared) ? obj.shared : []) {
    if (shared.length >= MAX_SERVERS) break
    const { url, claude } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    if (typeof url !== 'string' || !(isMachineUrl(url) || isThroughUrl(url)) || shared.some(kept => kept.url === url)) continue
    const login = readLogin(claude)
    shared.push({ url, ...(login ? { claude: login } : {}) })
  }
  return { servers, ...(Object.keys(own).length ? { own } : {}), shared }
}

/**
 * Whether `said` names a computer saved through a server, the way OpenAgent's machines do: the
 * server's door, then where it passes a call down that computer's line.
 */
export function isThroughUrl(said: string): boolean {
  // One no URL reads is none: it never fails the file it is in, nor the command it was given to.
  return new RegExp(`^https://[^/?#\\s]+${VIA_PREFIX}/[a-z0-9]{6,32}$`).test(said) && URL.canParse(said)
}

/** Whether `said` is a saved machine's address as OpenAgent keeps it: an origin, over HTTPS or on this computer's own network. */
export function isMachineUrl(said: string): boolean {
  try {
    const url = new URL(said)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === said
  } catch {
    return false
  }
}

const file = jsonFile('openagent-servers.json', 'server', sanitize)

/** The file's path: beside OpenAgent's own home file, by the same rule. */
export const storePath = file.path

/** The file as it stands; no file reads as no server. Throws {@link Unreadable} for a file that is there and cannot be read. */
export async function readStore(env: NodeJS.ProcessEnv): Promise<Store> {
  const store = await file.read(env)
  if (store === 'unreadable') throw new Unreadable(storePath(env), 'server')
  return store
}

/** Change the file: read it, apply `change`, write it back, with no other writer in between; one that cannot be read is never written over. */
export const update = file.update

/** Change the one server at `address`, when the file still holds it; answers what `apply` did, or `undefined` for a server that is gone. */
export function changeServer<T>(env: NodeJS.ProcessEnv, address: string, apply: (server: Server) => T): Promise<T | undefined> {
  return update(env, store => {
    const kept = store.servers.find(candidate => candidate.address === address)
    return kept ? apply(kept) : undefined
  })
}

import type { ModuleHost } from '@openagt/dashboard/module'
import { readDeviceRows, readPersonRows, runDevices, text, type Answer, type DeviceRow, type PersonRow } from './devices.js'

// What the section shows of this computer's servers: the answer of `devices server status`, read
// forgivingly, and the things a person does, each one of the package's own commands. The servers are this computer's, not a
// project's: each command runs in no project, so the section is there with no project added.

export type StepState = 'waiting' | 'running' | 'done' | 'failed'

/** One step of an install, as the page lists it. */
export interface StepRow {
  id: string
  label: string
  state: StepState
  /** For a step that failed: what the server said. */
  said?: string
}

export type LoginKind = 'github' | 'claude'

/** A login this computer makes for another computer, while it does. The login itself is never here. */
export interface LoginRow {
  /** It is being made right now. */
  working: boolean
  /** The making waits for the person: for a yes in this computer's browser. */
  asking?: boolean
  /** Why the last try ended without a login. */
  said?: string
}

/** A server this computer installed OpenAgent on, or is installing it on. */
export interface ServerRow {
  address: string
  /** Where the server's door answers: what OpenAgent's machines know it by. */
  url: string
  user: string
  fingerprint?: string
  working: boolean
  adding: boolean
  /** Set once this computer keeps a line open to the server: what the server may do through it. */
  reach?: Reach
  /** A computer reached through a server, with no door of its own on the internet: that server's door, which it keeps its line to. */
  through?: string
  /** For a computer reached through a server: who there may start runs on it. */
  who?: Who
  /** For a computer reached through a server: the people there who may start runs on it besides its owner, by name. */
  people?: string[]
  /** A computer on the person's Tailscale network, at its door there: no line is kept to it. */
  tailscale?: true
  steps: StepRow[]
}

/** The server's install ended with every step done: it is installed. */
export const installDone = (server: Pick<ServerRow, 'working' | 'steps'>): boolean => !server.working && server.steps.every(step => step.state === 'done')

/** The server's install ended at a step that failed. */
export const installFailed = (server: Pick<ServerRow, 'working' | 'steps'>): boolean => !server.working && server.steps.some(step => step.state === 'failed')

/** Who on its server may start runs on a computer reached through it: nobody, or its own person, with the people they pick there besides. */
export type Who = 'nobody' | 'me'

const WHO: readonly string[] = ['nobody', 'me']

/** What a server may do on this computer through the line this computer keeps to it: everything a machine is asked, or only read. */
export type Reach = 'full' | 'watch'

/** The link the server's door gives for a new machine. */
export interface DoorLink {
  url: string
  /** What is typed on another computer instead: where, and the code. */
  where: string
  code: string
  expires: string
}

/** What a server's door lists, and what this computer's own door says of its line there. */
export interface DevicesRead {
  devices: DeviceRow[]
  /** None until the server's owner is named. */
  persons: PersonRow[]
  /** Where the server's door is open, as it said: on the internet, on Tailscale, or neither. */
  door?: { https?: string; tailscale?: string }
  /** The server said no to the key this computer asks for its line with. */
  lineRefused: boolean
}

const STATES: readonly string[] = ['waiting', 'running', 'done', 'failed']

function readLogin(value: unknown): LoginRow {
  const { working, asking, said } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const words = text(said)
  return { working: working === true, ...(asking === true ? { asking: true } : {}), ...(words ? { said: words } : {}) }
}

export function readServers(output: unknown): ServerRow[] | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { servers } = output as Record<string, unknown>
  if (!Array.isArray(servers)) return undefined
  const rows: ServerRow[] = []
  for (const entry of servers) {
    if (!entry || typeof entry !== 'object') continue
    const { address, url, user, fingerprint, working, adding, reach, through, who, people, tailscale, steps } = entry as Record<string, unknown>
    const [at, door, by, known] = [text(address), text(url), text(user), text(fingerprint)]
    if (!at || !door || !by || !Array.isArray(steps)) continue
    const list: StepRow[] = []
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue
      const { id, label, state, said } = step as Record<string, unknown>
      const [stepId, name, words] = [text(id), text(label), text(said)]
      if (stepId && name && STATES.includes(state as string)) list.push({ id: stepId, label: name, state: state as StepState, ...(words ? { said: words } : {}) })
    }
    const via = text(through)
    const named = Array.isArray(people) ? people.flatMap(name => (text(name) ? [text(name)!] : [])) : []
    rows.push({ address: at, url: door, user: by, ...(known ? { fingerprint: known } : {}), working: working === true, adding: adding === true, ...(reach === 'full' || reach === 'watch' ? { reach } : {}), ...(via ? { through: via, who: WHO.includes(who as string) ? (who as Who) : 'me', ...(named.length ? { people: named } : {}) } : {}), ...(!via && tailscale === true ? { tailscale: true as const } : {}), steps: list })
  }
  return rows
}

export function readDevices(output: unknown): DevicesRead | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { devices, lineRefused, persons, door } = output as Record<string, unknown>
  if (!Array.isArray(devices)) return undefined
  const { https, tailscale } = (door && typeof door === 'object' ? door : {}) as Record<string, unknown>
  const [atHttps, atTailscale] = [text(https), text(tailscale)]
  const where = atHttps || atTailscale ? { ...(atHttps ? { https: atHttps } : {}), ...(atTailscale ? { tailscale: atTailscale } : {}) } : undefined
  return { devices: readDeviceRows(devices), persons: readPersonRows(persons), ...(where ? { door: where } : {}), lineRefused: lineRefused === true }
}

function readLink(output: unknown): DoorLink | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { url, where, code, expires } = output as Record<string, unknown>
  const [link, at, typed, until] = [text(url), text(where), text(code), text(expires)]
  return link && at && typed && until ? { url: link, where: at, code: typed, expires: until } : undefined
}

/** Run one of `devices server`'s commands on this computer, and read its answer with `read`. */
const run = <T>(host: ModuleHost, args: string[], read: (output: unknown) => T | undefined): Promise<Answer<T>> => runDevices(host, ['server', ...args], read)

/** What this computer says of its servers: the list, and whether it is itself a server OpenAgent was installed on. */
export interface ServersRead {
  servers: ServerRow[]
  isServer: boolean
}

export function readStatus(output: unknown): ServersRead | undefined {
  const servers = readServers(output)
  return servers && { servers, isServer: (output as Record<string, unknown>)['server'] === true }
}

export const loadServers = (host: ModuleHost): Promise<Answer<ServersRead>> => run(host, ['status'], readStatus)
/**
 * Install OpenAgent at `version` on the server, or go on where the install failed, or bring a server
 * that fell behind to it: one on the internet, one reached through the server at `through`, which it
 * keeps a line to in place of a door of its own, or one on the person's Tailscale network.
 */
export const connect = (host: ModuleHost, address: string, user: string, version: string, through?: string | 'tailscale'): Promise<Answer<ServerRow[]>> =>
  run(host, ['connect', address, user, version, ...(through === 'tailscale' ? ['--tailscale'] : through !== undefined ? ['--through', through] : [])], readServers)
/** What failed at a "Test connection", by what a person does about it. */
export type Trouble = 'unreachable' | 'no-ssh' | 'key' | 'no-key' | 'sudo' | 'host-key' | 'system'
const TROUBLES: readonly string[] = ['unreachable', 'no-ssh', 'key', 'no-key', 'sudo', 'host-key', 'system']

/** One try at logging in to a server over SSH, with nothing changed there: what it runs, or what failed, with the line to paste there for what is fixed there. */
export type Tested = { ok: true; system: string } | { ok: false; trouble: Trouble; reached: boolean; said: string; key?: string; fix?: string }

function readTested(output: unknown): Tested | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { ok, system, trouble, reached, said, key, fix } = output as Record<string, unknown>
  if (ok === true) return { ok: true, system: text(system) ?? '' }
  if (ok !== false || !TROUBLES.includes(trouble as string)) return undefined
  const [publicKey, line] = [text(key), text(fix)]
  return { ok: false, trouble: trouble as Trouble, reached: reached === true, said: text(said) ?? '', ...(publicKey ? { key: publicKey } : {}), ...(line ? { fix: line } : {}) }
}

export const testConnection = (host: ModuleHost, address: string, user: string): Promise<Answer<Tested>> => run(host, ['test', address, user], readTested)
/** Save a computer reached through a server among the machines, through that server, once its install is done. */
export const addThrough = (host: ModuleHost, address: string): Promise<Answer<ServerRow[]>> => run(host, ['add-through', address], readServers)
/** Say whether its server may start its own person's runs on a computer reached through it, or only show them: the people named on it stay as they are. */
export const setWho = (host: ModuleHost, address: string, who: Who): Promise<Answer<DevicesRead>> => run(host, ['who', address, who], readDevices)
/** Name the people on its server who may start runs on a computer reached through it, besides its own person. */
export const setPeople = (host: ModuleHost, address: string, people: readonly string[]): Promise<Answer<DevicesRead>> => run(host, ['people', address, ...people], readDevices)
/** Whose GitHub login a copy would be: the account this computer's `gh` is logged in to, or why there is none to copy. */
export type OwnGithub = { account: string } | { problem: string }

function readOwn(output: unknown): OwnGithub | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { account, problem } = output as Record<string, unknown>
  const [who, why] = [text(account), text(problem)]
  return who ? { account: who } : why ? { problem: why } : undefined
}

export const ownGithub = (host: ModuleHost): Promise<Answer<OwnGithub>> => run(host, ['github'], readOwn)
export const askLink = (host: ModuleHost, address: string, person?: string): Promise<Answer<DoorLink>> => run(host, ['link', address, ...(person !== undefined ? ['--for', person] : [])], readLink)
/** Name the server's owner at its door. */
export const nameOwner = (host: ModuleHost, address: string, name: string): Promise<Answer<DevicesRead>> => run(host, ['owner', address, name], readDevices)
/** Take a person out on the server, with every device of theirs. */
export const removePerson = (host: ModuleHost, address: string, name: string): Promise<Answer<DevicesRead>> => run(host, ['remove-person', address, name], readDevices)
export const markAdded = (host: ModuleHost, address: string): Promise<Answer<ServerRow[]>> => run(host, ['added', address], readServers)
export const forget = (host: ModuleHost, address: string): Promise<Answer<ServerRow[]>> => run(host, ['forget', address], readServers)
/** Keep a line open from this computer to the server, and say what the server may do through it. */
export const reach = (host: ModuleHost, address: string, mode: Reach): Promise<Answer<ServerRow[]>> => run(host, ['reach', address, mode], readServers)
/** The devices that are in on the server, asked of its door over SSH; with `last`, as last told on this computer, at once. */
export const loadDevices = (host: ModuleHost, address: string, last = false): Promise<Answer<DevicesRead>> => run(host, ['devices', address, ...(last ? ['--last'] : [])], readDevices)
/** Take one device out on the server, a computer with all it holds there; answers the ones still in. */
export const removeDevice = (host: ModuleHost, address: string, id: string): Promise<Answer<DevicesRead>> => run(host, ['remove-device', address, id], readDevices)

/** What this computer keeps for a server someone invited its person to: its line there. */
export interface SharedRow {
  url: string
  reach?: Reach
  lineRefused: boolean
  /** The id the line has among the server's devices. */
  line?: string
}

function readShared(output: unknown): SharedRow[] | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { shared } = output as Record<string, unknown>
  if (!Array.isArray(shared)) return undefined
  const rows: SharedRow[] = []
  for (const entry of shared) {
    const { url, reach, lineRefused, line } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const [at, id] = [text(url), text(line)]
    if (at) rows.push({ url: at, ...(reach === 'full' || reach === 'watch' ? { reach } : {}), lineRefused: lineRefused === true, ...(id ? { line: id } : {}) })
  }
  return rows
}

/** What this computer keeps for servers someone invited its person to, by their addresses. */
export const loadShared = (host: ModuleHost, urls: string[]): Promise<Answer<SharedRow[]>> => run(host, ['shared', ...urls], readShared)
/** Keep a line open to the server as this person's, and say what it may do through it; or none. */
export const sharedReach = (host: ModuleHost, url: string, mode: Reach | 'off'): Promise<Answer<SharedRow[]>> => run(host, ['shared-reach', url, mode], readShared)
/** Forget the server here, and the line to it. */
export const sharedForget = (host: ModuleHost, url: string): Promise<Answer<SharedRow[]>> => run(host, ['shared-forget', url], readShared)

/** One login of this person's on another person's computer, as that computer says it: a copy from a server, or made there. */
export interface OtherLogin {
  source: 'copied' | 'made'
  /** For a copy: the server it came from. */
  from?: string
  /** GitHub: whose it is. */
  account?: string
}

/** What this computer reads of another person's computer shared with everyone: the person's logins there, and the Claude login it makes for it in this browser. */
export interface OtherRow {
  url: string
  github?: OtherLogin
  claude?: OtherLogin
  /** Why that computer could not be asked. */
  error?: string
  /** The Claude login this computer makes for it right now, or why the last try failed. */
  making: LoginRow
}

function readOtherLogin(value: unknown): OtherLogin | undefined {
  const { source, from, account } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  if (source !== 'copied' && source !== 'made') return undefined
  const [where, who] = [text(from), text(account)]
  return { source, ...(where ? { from: where } : {}), ...(who ? { account: who } : {}) }
}

function readOther(output: unknown): OtherRow[] | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { other } = output as Record<string, unknown>
  if (!Array.isArray(other)) return undefined
  const rows: OtherRow[] = []
  for (const entry of other) {
    const { url, logins, error, claude } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const { github: githubThere, claude: claudeThere } = (logins && typeof logins === 'object' ? logins : {}) as Record<string, unknown>
    const [at, why] = [text(url), text(error)]
    const [github, claudeLogin] = [readOtherLogin(githubThere), readOtherLogin(claudeThere)]
    if (at) rows.push({ url: at, ...(github ? { github } : {}), ...(claudeLogin ? { claude: claudeLogin } : {}), ...(why ? { error: why } : {}), making: readLogin(claude) })
  }
  return rows
}

/** What other persons' computers say of this person's logins there, and the Claude login this computer makes for each. */
export const loadOther = (host: ModuleHost, urls: string[]): Promise<Answer<OtherRow[]>> => run(host, ['other', ...urls], readOther)
/** Hand a login made here to this person's own OpenAgent on another person's computer: GitHub's copied from this computer, Claude's made in this browser. */
export const otherLogin = (host: ModuleHost, url: string, kind: LoginKind): Promise<Answer<OtherRow[]>> => run(host, ['other-login', url, kind], readOther)

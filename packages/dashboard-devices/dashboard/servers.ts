import type { ModuleHost } from '@openagt/dashboard/module'

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
  /** A computer on the person's Tailscale network, at its door there: no line is kept to it. */
  tailscale?: true
  steps: StepRow[]
}

/** Who on its server may start runs on a computer reached through it: nobody, its own person, or every person there. */
export type Who = 'nobody' | 'me' | 'everyone'

const WHO: readonly string[] = ['nobody', 'me', 'everyone']

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

/** A phone, a browser or a computer that is in on a server, as the server's door lists it. */
export interface DeviceRow {
  id: string
  name: string
  added: string
  seen?: string
  /** A computer that keeps a line open to the server. */
  line?: true
  /** A computer is one row: the ids of what else it holds on the server. */
  also?: string[]
  /** That computer is this one, by the line it keeps open to the server. */
  own?: true
  /** Whose device it is, by their name, once the server has persons. */
  person?: string
}

/** A person on a server, by their name; the owner first. */
export interface PersonRow {
  name: string
  owner?: true
  /** Their own user and OpenAgent on the server are being made right now. */
  working?: true
  /** Why their own user could not be made. */
  problem?: string
  /** On a computer reached through a server: the server whose line made this person's user there. */
  from?: string
  /** That server no longer has the person, and nobody said to keep their user. */
  removed?: true
  /** Their user is kept, switched off, though that server no longer has them. */
  kept?: true
}

/** What a server's door lists, and what this computer's own door says of its line there. */
export interface DevicesRead {
  devices: DeviceRow[]
  /** None until the server's owner is named. */
  persons: PersonRow[]
  /** The server said no to the key this computer asks for its line with. */
  lineRefused: boolean
}

/** Every id a row is listed under: its own, and those of what else the computer holds there. */
export const idsOf = (device: Pick<DeviceRow, 'id' | 'also'>): string[] => [device.id, ...(device.also ?? [])]

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string }

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
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
    const { address, url, user, fingerprint, working, adding, reach, through, who, tailscale, steps } = entry as Record<string, unknown>
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
    rows.push({ address: at, url: door, user: by, ...(known ? { fingerprint: known } : {}), working: working === true, adding: adding === true, ...(reach === 'full' || reach === 'watch' ? { reach } : {}), ...(via ? { through: via, who: WHO.includes(who as string) ? (who as Who) : 'me' } : {}), ...(!via && tailscale === true ? { tailscale: true as const } : {}), steps: list })
  }
  return rows
}

export function readDevices(output: unknown): DevicesRead | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { devices, lineRefused, persons } = output as Record<string, unknown>
  if (!Array.isArray(devices)) return undefined
  const rows: DeviceRow[] = []
  for (const entry of devices) {
    if (!entry || typeof entry !== 'object') continue
    const { id, name, added, seen, line, also, own, person } = entry as Record<string, unknown>
    const [deviceId, deviceName, addedAt, seenAt, whose] = [text(id), text(name), text(added), text(seen), text(person)]
    const others = Array.isArray(also) ? also.filter((other): other is string => typeof other === 'string' && other !== '') : []
    if (deviceId && deviceName && addedAt)
      rows.push({ id: deviceId, name: deviceName, added: addedAt, ...(seenAt ? { seen: seenAt } : {}), ...(line === true ? { line: true } : {}), ...(others.length ? { also: others } : {}), ...(own === true ? { own: true } : {}), ...(whose ? { person: whose } : {}) })
  }
  const people: PersonRow[] = []
  for (const entry of Array.isArray(persons) ? persons : []) {
    const { name, owner, working, problem, from, removed, kept } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const [known, why, via] = [text(name), text(problem), text(from)]
    if (known && !people.some(person => person.name === known))
      people.push({ name: known, ...(owner === true ? { owner: true as const } : {}), ...(working === true ? { working: true as const } : {}), ...(why ? { problem: why } : {}), ...(via ? { from: via } : {}), ...(removed === true ? { removed: true as const } : {}), ...(kept === true ? { kept: true as const } : {}) })
  }
  return { devices: rows, persons: people, lineRefused: lineRefused === true }
}

function readLink(output: unknown): DoorLink | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { url, where, code, expires } = output as Record<string, unknown>
  const [link, at, typed, until] = [text(url), text(where), text(code), text(expires)]
  return link && at && typed && until ? { url: link, where: at, code: typed, expires: until } : undefined
}

async function run<T>(host: ModuleHost, args: string[], read: (output: unknown) => T | undefined): Promise<Answer<T>> {
  const result = await host.runComputerCommand(['server', ...args]).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
  if (!result.ok) return result
  const value = read(result.output)
  return value !== undefined ? { ok: true, value } : { ok: false, error: 'the command answered something else than expected' }
}

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
 * Install OpenAgent at `version` on the server, or go on where the install failed, or bring a server that fell behind to it.
 * With `through`, the computer has no door of its own on the internet: it keeps a line to that server instead.
 */
/** Install OpenAgent on a server: one on the internet, one reached through the server at `through`, or one on the person's Tailscale network. */
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
/** Say who on its server may start runs on a computer reached through it; with `remove`, the users of the others there go. */
export const setWho = (host: ModuleHost, address: string, who: Who, remove = false): Promise<Answer<DevicesRead>> => run(host, ['who', address, who, ...(remove ? ['remove'] : [])], readDevices)
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

/** What a server's door says of this computer's person there: who they are, whether they are its owner, and their devices. */
export interface PersonThere {
  /** Their name there, once the server has persons. */
  person?: string
  owner: boolean
  devices: DeviceRow[]
}

/** The door's answer, read as another computer's data: anything that is not what it should be is left out. */
export function readPersonThere(said: unknown): PersonThere | undefined {
  if (!said || typeof said !== 'object') return undefined
  const { person, owner } = said as Record<string, unknown>
  const listed = readDevices(said)
  const who = text(person)
  return listed && typeof owner === 'boolean' ? { ...(who ? { person: who } : {}), owner, devices: listed.devices } : undefined
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

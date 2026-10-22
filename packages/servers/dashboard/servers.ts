import type { ModuleHost } from '@openagt/dashboard/module'

// What the section shows of this computer's servers: the answer of `servers status`, read
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

/** One login of a server, as this computer left it. The login itself is never here. */
export interface LoginRow {
  /** This computer put it on the server, and did not take it off since. */
  there: boolean
  /** It is being changed right now, or the install copies it at its end. */
  working: boolean
  /** The change waits for the person: for a yes in this computer's browser (Claude), or for a code typed at GitHub. */
  asking?: boolean
  /** GitHub: the code the person types at github.com/login/device while the server waits for it. */
  code?: string
  /** GitHub: the person asked for a copy, and it was not made yet. */
  wanted?: boolean
  /** GitHub: whose it is. */
  account?: string
  /** ISO 8601: when it was put there. */
  since?: string
  /** Claude: when it ends by itself. */
  ends?: string
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
  steps: StepRow[]
  logins: Record<LoginKind, LoginRow>
  /** The Claude accounts the server has beside its own login, as it last said them. */
  claudeAccounts: AccountRow[]
  /** A Claude account being added, or the last one that did not get there. */
  claudeAdding?: { name: string; working: boolean; asking?: boolean; said?: string }
}

/** One Claude account a server has beside its own login: never the login itself. */
export interface AccountRow {
  name: string
  /** ISO 8601. */
  added?: string
  /** Epoch milliseconds: a limit it hit keeps runs off it until then. */
  limitedUntil?: number
  /** How full its windows were at the last run on it, by the agent's own names (`five_hour`, `seven_day`). */
  windows?: { window: string; percentUsed: number; resetsAt: number }[]
}

/** Who on its server may start runs on a computer reached through it: nobody, its own person, or every person there. */
export type Who = 'nobody' | 'me' | 'everyone'

const WHO: readonly string[] = ['nobody', 'me', 'everyone']

/** What a server may do on this computer through the line this computer keeps to it: everything a machine is asked, or only read. */
export type Reach = 'full' | 'watch'

/** The link the server's door gives for a new machine. */
export interface DoorLink {
  url: string
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
  /** Whose device it is, by their GitHub account, once the server has persons. */
  person?: string
}

/** A person on a server, by their GitHub account; the owner first. */
export interface PersonRow {
  account: string
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
  const { there, working, asking, code, wanted, account, since, ends, said } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const [who, from, until, words, typedAtGithub] = [text(account), text(since), text(ends), text(said), text(code)]
  return { there: there === true, working: working === true, ...(asking === true ? { asking: true, ...(typedAtGithub ? { code: typedAtGithub } : {}) } : {}), ...(wanted === true ? { wanted: true } : {}), ...(who ? { account: who } : {}), ...(from ? { since: from } : {}), ...(until ? { ends: until } : {}), ...(words ? { said: words } : {}) }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function readAccount(value: unknown): AccountRow | undefined {
  const { name, added, limitedUntil, windows } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const called = text(name)
  if (!called) return undefined
  const said = Array.isArray(windows)
    ? windows.flatMap(w => {
        const { window, percentUsed, resetsAt } = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>
        return text(window) && finite(percentUsed) && finite(resetsAt) ? [{ window: window as string, percentUsed, resetsAt }] : []
      })
    : []
  return { name: called, ...(text(added) ? { added: added as string } : {}), ...(finite(limitedUntil) ? { limitedUntil } : {}), ...(said.length > 0 ? { windows: said } : {}) }
}

function readAdding(value: unknown): ServerRow['claudeAdding'] {
  const { name, working, asking, said } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const called = text(name)
  return called ? { name: called, working: working === true, ...(asking === true ? { asking: true } : {}), ...(text(said) ? { said: said as string } : {}) } : undefined
}

export function readServers(output: unknown): ServerRow[] | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { servers } = output as Record<string, unknown>
  if (!Array.isArray(servers)) return undefined
  const rows: ServerRow[] = []
  for (const entry of servers) {
    if (!entry || typeof entry !== 'object') continue
    const { address, url, user, fingerprint, working, adding, reach, through, who, steps, logins, claudeAccounts, claudeAdding } = entry as Record<string, unknown>
    const { github, claude } = (logins && typeof logins === 'object' ? logins : {}) as Record<string, unknown>
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
    rows.push({ address: at, url: door, user: by, ...(known ? { fingerprint: known } : {}), working: working === true, adding: adding === true, ...(reach === 'full' || reach === 'watch' ? { reach } : {}), ...(via ? { through: via, who: WHO.includes(who as string) ? (who as Who) : 'me' } : {}), steps: list, logins: { github: readLogin(github), claude: readLogin(claude) }, claudeAccounts: Array.isArray(claudeAccounts) ? claudeAccounts.flatMap(kept => readAccount(kept) ?? []) : [], ...(readAdding(claudeAdding) ? { claudeAdding: readAdding(claudeAdding)! } : {}) })
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
    const { account, owner, working, problem, from, removed, kept } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const [known, why, via] = [text(account), text(problem), text(from)]
    if (known && !people.some(person => person.account === known))
      people.push({ account: known, ...(owner === true ? { owner: true as const } : {}), ...(working === true ? { working: true as const } : {}), ...(why ? { problem: why } : {}), ...(via ? { from: via } : {}), ...(removed === true ? { removed: true as const } : {}), ...(kept === true ? { kept: true as const } : {}) })
  }
  return { devices: rows, persons: people, lineRefused: lineRefused === true }
}

function readLink(output: unknown): DoorLink | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { url, expires } = output as Record<string, unknown>
  const [link, until] = [text(url), text(expires)]
  return link && until ? { url: link, expires: until } : undefined
}

async function run<T>(host: ModuleHost, args: string[], read: (output: unknown) => T | undefined): Promise<Answer<T>> {
  const result = await host.runComputerCommand(args).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
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
 * With `github`, this computer's GitHub login is copied to the server once it is installed. With
 * `through`, the computer has no door of its own on the internet: it keeps a line to that server instead.
 */
export const connect = (host: ModuleHost, address: string, user: string, version: string, github = false, through?: string): Promise<Answer<ServerRow[]>> =>
  run(host, ['connect', address, user, version, ...(github ? ['github'] : []), ...(through !== undefined ? ['--through', through] : [])], readServers)
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
/**
 * Give the server a login: GitHub's is this computer's own, copied, or with `own` one the server
 * gets for itself, with a code the person types at GitHub; Claude's is made new, once the person
 * said yes in this computer's browser.
 */
export const login = (host: ModuleHost, address: string, kind: LoginKind, own = false): Promise<Answer<ServerRow[]>> => run(host, ['login', address, kind, ...(own ? ['own'] : [])], readServers)
/** Take a login off the server. */
export const logout = (host: ModuleHost, address: string, kind: LoginKind): Promise<Answer<ServerRow[]>> => run(host, ['logout', address, kind], readServers)
export const loadAccounts = (host: ModuleHost, address: string): Promise<Answer<ServerRow[]>> => run(host, ['accounts', address], readServers)
export const addAccount = (host: ModuleHost, address: string, name: string): Promise<Answer<ServerRow[]>> => run(host, ['account-add', address, name], readServers)
export const removeAccount = (host: ModuleHost, address: string, name: string): Promise<Answer<ServerRow[]>> => run(host, ['account-remove', address, name], readServers)
export const askLink = (host: ModuleHost, address: string, person?: string): Promise<Answer<DoorLink>> => run(host, ['link', address, ...(person !== undefined ? ['--for', person] : [])], readLink)
/** Name the server's owner at its door, by their GitHub account. */
export const nameOwner = (host: ModuleHost, address: string, account: string): Promise<Answer<DevicesRead>> => run(host, ['owner', address, account], readDevices)
/** Take a person out on the server, with every device of theirs. */
export const removePerson = (host: ModuleHost, address: string, account: string): Promise<Answer<DevicesRead>> => run(host, ['remove-person', address, account], readDevices)
export const markAdded = (host: ModuleHost, address: string): Promise<Answer<ServerRow[]>> => run(host, ['added', address], readServers)
export const forget = (host: ModuleHost, address: string): Promise<Answer<ServerRow[]>> => run(host, ['forget', address], readServers)
/** Keep a line open from this computer to the server, and say what the server may do through it. */
export const reach = (host: ModuleHost, address: string, mode: Reach): Promise<Answer<ServerRow[]>> => run(host, ['reach', address, mode], readServers)
/** The devices that are in on the server, asked of its door over SSH. */
export const loadDevices = (host: ModuleHost, address: string): Promise<Answer<DevicesRead>> => run(host, ['devices', address], readDevices)
/** Take one device out on the server, a computer with all it holds there; answers the ones still in. */
export const removeDevice = (host: ModuleHost, address: string, id: string): Promise<Answer<DevicesRead>> => run(host, ['remove-device', address, id], readDevices)

/** A person's own OpenAgent on a computer several people use: whose it is, and the logins it holds for that person's runs. */
export interface OwnRead {
  person: string
  logins: Record<LoginKind, LoginRow>
}

function readOwnLogins(output: unknown): OwnRead | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { person, logins } = output as Record<string, unknown>
  const { github, claude } = (logins && typeof logins === 'object' ? logins : {}) as Record<string, unknown>
  const who = text(person)
  return who ? { person: who, logins: { github: readLogin(github), claude: readLogin(claude) } } : undefined
}

/** What this computer keeps for a server someone invited its person to: its line there, and the Claude login it makes for it in this browser. */
export interface SharedRow {
  url: string
  reach?: Reach
  lineRefused: boolean
  /** The id the line has among the server's devices. */
  line?: string
  claude: LoginRow
}

function readShared(output: unknown): SharedRow[] | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { shared } = output as Record<string, unknown>
  if (!Array.isArray(shared)) return undefined
  const rows: SharedRow[] = []
  for (const entry of shared) {
    const { url, reach, lineRefused, line, claude } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const [at, id] = [text(url), text(line)]
    if (at) rows.push({ url: at, ...(reach === 'full' || reach === 'watch' ? { reach } : {}), lineRefused: lineRefused === true, ...(id ? { line: id } : {}), claude: readLogin(claude) })
  }
  return rows
}

/** What a server's door says of this computer's person there: who they are, whether they are its owner, and their devices. */
export interface PersonThere {
  account?: string
  owner: boolean
  devices: DeviceRow[]
}

/** The door's answer, read as another computer's data: anything that is not what it should be is left out. */
export function readPersonThere(said: unknown): PersonThere | undefined {
  if (!said || typeof said !== 'object') return undefined
  const { account, owner } = said as Record<string, unknown>
  const listed = readDevices(said)
  const who = text(account)
  return listed && typeof owner === 'boolean' ? { ...(who ? { account: who } : {}), owner, devices: listed.devices } : undefined
}

/** What this person's own OpenAgent on the server says of its logins. */
export const loadOwn = (host: ModuleHost, machine: string): Promise<Answer<OwnRead>> => runOn(host, machine, ['own'], readOwnLogins)
/** The server asks GitHub for a login of this person's own, with a code typed at GitHub. */
export const ownCodeLogin = (host: ModuleHost, machine: string): Promise<Answer<OwnRead>> => runOn(host, machine, ['own', 'login', 'github', 'own'], readOwnLogins)
/** Take one of this person's logins off the server. */
export const ownLogout = (host: ModuleHost, machine: string, kind: LoginKind): Promise<Answer<OwnRead>> => runOn(host, machine, ['own', 'logout', kind], readOwnLogins)
/** What this computer keeps for servers someone invited its person to, by their addresses. */
export const loadShared = (host: ModuleHost, urls: string[]): Promise<Answer<SharedRow[]>> => run(host, ['shared', ...urls], readShared)
/** Copy this computer's GitHub login to this person's own OpenAgent on the server; answers what that one says of its logins. */
export const sharedGithub = (host: ModuleHost, url: string): Promise<Answer<OwnRead>> => run(host, ['shared-login', url, 'github'], readOwnLogins)
/** Make a Claude login for this person's own OpenAgent on the server, in this computer's browser. */
export const sharedClaude = (host: ModuleHost, url: string): Promise<Answer<SharedRow[]>> => run(host, ['shared-login', url, 'claude'], readShared)
/** Keep a line open to the server as this person's, and say what it may do through it; or none. */
export const sharedReach = (host: ModuleHost, url: string, mode: Reach | 'off'): Promise<Answer<SharedRow[]>> => run(host, ['shared-reach', url, mode], readShared)
/** Forget the server here, and the line to it. */
export const sharedForget = (host: ModuleHost, url: string): Promise<Answer<SharedRow[]>> => run(host, ['shared-forget', url], readShared)

async function runOn<T>(host: ModuleHost, machine: string, args: string[], read: (output: unknown) => T | undefined): Promise<Answer<T>> {
  const result = await host.runComputerCommandOn(machine, args).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
  if (!result.ok) return result
  const value = read(result.output)
  return value !== undefined ? { ok: true, value } : { ok: false, error: 'the server answered something else than expected' }
}

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

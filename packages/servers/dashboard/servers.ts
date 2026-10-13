import type { ModuleHost } from '@openagt/dashboard/module'

// What the section shows: the answer of `servers status`, read forgivingly, and the things a
// person does, each one of the package's own commands. The servers are this computer's, not a
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
  steps: StepRow[]
  logins: Record<LoginKind, LoginRow>
}

/** What a server may do on this computer through the line this computer keeps to it: everything a machine is asked, or only read. */
export type Reach = 'full' | 'watch'

/** The link the server's door gives for a new machine. */
export interface DoorLink {
  url: string
  expires: string
}

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string }

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
const STATES: readonly string[] = ['waiting', 'running', 'done', 'failed']

function readLogin(value: unknown): LoginRow {
  const { there, working, asking, code, wanted, account, since, ends, said } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const [who, from, until, words, typedAtGithub] = [text(account), text(since), text(ends), text(said), text(code)]
  return { there: there === true, working: working === true, ...(asking === true ? { asking: true, ...(typedAtGithub ? { code: typedAtGithub } : {}) } : {}), ...(wanted === true ? { wanted: true } : {}), ...(who ? { account: who } : {}), ...(from ? { since: from } : {}), ...(until ? { ends: until } : {}), ...(words ? { said: words } : {}) }
}

export function readServers(output: unknown): ServerRow[] | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { servers } = output as Record<string, unknown>
  if (!Array.isArray(servers)) return undefined
  const rows: ServerRow[] = []
  for (const entry of servers) {
    if (!entry || typeof entry !== 'object') continue
    const { address, url, user, fingerprint, working, adding, reach, steps, logins } = entry as Record<string, unknown>
    const { github, claude } = (logins && typeof logins === 'object' ? logins : {}) as Record<string, unknown>
    const [at, door, who, known] = [text(address), text(url), text(user), text(fingerprint)]
    if (!at || !door || !who || !Array.isArray(steps)) continue
    const list: StepRow[] = []
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue
      const { id, label, state, said } = step as Record<string, unknown>
      const [stepId, name, words] = [text(id), text(label), text(said)]
      if (stepId && name && STATES.includes(state as string)) list.push({ id: stepId, label: name, state: state as StepState, ...(words ? { said: words } : {}) })
    }
    rows.push({ address: at, url: door, user: who, ...(known ? { fingerprint: known } : {}), working: working === true, adding: adding === true, ...(reach === 'full' || reach === 'watch' ? { reach } : {}), steps: list, logins: { github: readLogin(github), claude: readLogin(claude) } })
  }
  return rows
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
 * With `github`, this computer's GitHub login is copied to the server once it is installed.
 */
export const connect = (host: ModuleHost, address: string, user: string, version: string, github = false): Promise<Answer<ServerRow[]>> =>
  run(host, ['connect', address, user, version, ...(github ? ['github'] : [])], readServers)
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
export const askLink = (host: ModuleHost, address: string): Promise<Answer<DoorLink>> => run(host, ['link', address], readLink)
export const markAdded = (host: ModuleHost, address: string): Promise<Answer<ServerRow[]>> => run(host, ['added', address], readServers)
export const forget = (host: ModuleHost, address: string): Promise<Answer<ServerRow[]>> => run(host, ['forget', address], readServers)
/** Keep a line open from this computer to the server, and say what the server may do through it. */
export const reach = (host: ModuleHost, address: string, mode: Reach): Promise<Answer<ServerRow[]>> => run(host, ['reach', address, mode], readServers)

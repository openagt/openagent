import type { ModuleHost, ModuleProject } from '@openagt/dashboard/module'

// What the section shows: the answer of `servers status`, read forgivingly, and the things a
// person does, each one of the package's own commands. The servers are this computer's, not a
// project's: the dashboard runs a package's command in a project, so each is run in the first
// project that answers, and reads the same in any.

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
  /** It is on its way: the install copies it at its end, or this computer's browser waits for the person. */
  working: boolean
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
  steps: StepRow[]
  logins: Record<LoginKind, LoginRow>
}

/** The link the server's door gives for a new machine. */
export interface DoorLink {
  url: string
  expires: string
}

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string }

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
const STATES: readonly string[] = ['waiting', 'running', 'done', 'failed']

function readLogin(value: unknown): LoginRow {
  const { there, working, wanted, account, since, ends, said } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const [who, from, until, words] = [text(account), text(since), text(ends), text(said)]
  return { there: there === true, working: working === true, ...(wanted === true ? { wanted: true } : {}), ...(who ? { account: who } : {}), ...(from ? { since: from } : {}), ...(until ? { ends: until } : {}), ...(words ? { said: words } : {}) }
}

export function readServers(output: unknown): ServerRow[] | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { servers } = output as Record<string, unknown>
  if (!Array.isArray(servers)) return undefined
  const rows: ServerRow[] = []
  for (const entry of servers) {
    if (!entry || typeof entry !== 'object') continue
    const { address, url, user, fingerprint, working, adding, steps, logins } = entry as Record<string, unknown>
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
    rows.push({ address: at, url: door, user: who, ...(known ? { fingerprint: known } : {}), working: working === true, adding: adding === true, steps: list, logins: { github: readLogin(github), claude: readLogin(claude) } })
  }
  return rows
}

function readLink(output: unknown): DoorLink | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { url, expires } = output as Record<string, unknown>
  const [link, until] = [text(url), text(expires)]
  return link && until ? { url: link, expires: until } : undefined
}

async function run<T>(host: ModuleHost, projects: ModuleProject[], args: string[], read: (output: unknown) => T | undefined): Promise<Answer<T>> {
  let first: Answer<T> = { ok: false, error: 'no project to run the command in' }
  // A project whose folder is gone cannot run anything: the next one is asked, and the first failure is the one told.
  for (const [index, project] of projects.entries()) {
    const result = await host.runCommand(project.id, args).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (result.ok) {
      const value = read(result.output)
      return value !== undefined ? { ok: true, value } : { ok: false, error: 'the command answered something else than expected' }
    }
    if (index === 0) first = result
  }
  return first
}

export const loadServers = (host: ModuleHost, projects: ModuleProject[]): Promise<Answer<ServerRow[]>> => run(host, projects, ['status'], readServers)
/**
 * Install OpenAgent at `version` on the server, or go on where the install failed, or bring a server that fell behind to it.
 * With `github`, this computer's GitHub login is copied to the server once it is installed.
 */
export const connect = (host: ModuleHost, projects: ModuleProject[], address: string, user: string, version: string, github = false): Promise<Answer<ServerRow[]>> =>
  run(host, projects, ['connect', address, user, version, ...(github ? ['github'] : [])], readServers)
/** Whose GitHub login a copy would be: the account this computer's `gh` is logged in to, or why there is none to copy. */
export type OwnGithub = { account: string } | { problem: string }

function readOwn(output: unknown): OwnGithub | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { account, problem } = output as Record<string, unknown>
  const [who, why] = [text(account), text(problem)]
  return who ? { account: who } : why ? { problem: why } : undefined
}

export const ownGithub = (host: ModuleHost, projects: ModuleProject[]): Promise<Answer<OwnGithub>> => run(host, projects, ['github'], readOwn)
/** Give the server a login: GitHub's is this computer's own, copied; Claude's is made new, once the person said yes in this computer's browser. */
export const login = (host: ModuleHost, projects: ModuleProject[], address: string, kind: LoginKind): Promise<Answer<ServerRow[]>> => run(host, projects, ['login', address, kind], readServers)
/** Take a login off the server. */
export const logout = (host: ModuleHost, projects: ModuleProject[], address: string, kind: LoginKind): Promise<Answer<ServerRow[]>> => run(host, projects, ['logout', address, kind], readServers)
export const askLink = (host: ModuleHost, projects: ModuleProject[], address: string): Promise<Answer<DoorLink>> => run(host, projects, ['link', address], readLink)
export const markAdded = (host: ModuleHost, projects: ModuleProject[], address: string): Promise<Answer<ServerRow[]>> => run(host, projects, ['added', address], readServers)
export const forget = (host: ModuleHost, projects: ModuleProject[], address: string): Promise<Answer<ServerRow[]>> => run(host, projects, ['forget', address], readServers)

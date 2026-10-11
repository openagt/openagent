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

/** A server this computer installed OpenAgent on, or is installing it on. */
export interface ServerRow {
  address: string
  user: string
  fingerprint?: string
  working: boolean
  adding: boolean
  steps: StepRow[]
}

/** The link the server's door gives for a new machine. */
export interface DoorLink {
  url: string
  expires: string
}

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string }

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
const STATES: readonly string[] = ['waiting', 'running', 'done', 'failed']

export function readServers(output: unknown): ServerRow[] | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { servers } = output as Record<string, unknown>
  if (!Array.isArray(servers)) return undefined
  const rows: ServerRow[] = []
  for (const entry of servers) {
    if (!entry || typeof entry !== 'object') continue
    const { address, user, fingerprint, working, adding, steps } = entry as Record<string, unknown>
    const [at, who, known] = [text(address), text(user), text(fingerprint)]
    if (!at || !who || !Array.isArray(steps)) continue
    const list: StepRow[] = []
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue
      const { id, label, state, said } = step as Record<string, unknown>
      const [stepId, name, words] = [text(id), text(label), text(said)]
      if (stepId && name && STATES.includes(state as string)) list.push({ id: stepId, label: name, state: state as StepState, ...(words ? { said: words } : {}) })
    }
    rows.push({ address: at, user: who, ...(known ? { fingerprint: known } : {}), working: working === true, adding: adding === true, steps: list })
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
/** Install OpenAgent at `version` on the server, or go on where the install failed, or bring a server that fell behind to it. */
export const connect = (host: ModuleHost, projects: ModuleProject[], address: string, user: string, version: string): Promise<Answer<ServerRow[]>> =>
  run(host, projects, ['connect', address, user, version], readServers)
export const askLink = (host: ModuleHost, projects: ModuleProject[], address: string): Promise<Answer<DoorLink>> => run(host, projects, ['link', address], readLink)
export const markAdded = (host: ModuleHost, projects: ModuleProject[], address: string): Promise<Answer<ServerRow[]>> => run(host, projects, ['added', address], readServers)
export const forget = (host: ModuleHost, projects: ModuleProject[], address: string): Promise<Answer<ServerRow[]>> => run(host, projects, ['forget', address], readServers)

/** Where a server's door answers, as OpenAgent's machines know it. */
export function machineUrl(address: string): string {
  return `https://${address.includes(':') ? `[${address}]` : address}`
}

import type { ModuleHost, ModuleProject } from '@openagt/dashboard/module'

// What the section shows: the answer of `remote-access status`, read forgivingly, and the three
// things a person does, each one of the package's own commands. The devices are this computer's,
// not a project's: the dashboard runs a package's command in a project, so each is run in the
// first project that answers, and reads the same in any.

/** A phone or a browser that is in. */
export interface DeviceRow {
  id: string
  name: string
  added: string
  seen?: string
}

/** The door as `status` tells it. */
export interface DoorStatus {
  on: boolean
  listening: boolean
  problem?: string
  devices: DeviceRow[]
}

/** The link a new device gets in with: what the QR code holds. */
export interface AddLink {
  url: string
  /** The same link by this computer's number, when `url` goes by its name. */
  numberUrl?: string
  expires: string
}

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string }

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

export function readStatus(output: unknown): DoorStatus | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { on, listening, problem, devices } = output as Record<string, unknown>
  if (typeof on !== 'boolean' || !Array.isArray(devices)) return undefined
  const rows: DeviceRow[] = []
  for (const entry of devices) {
    if (!entry || typeof entry !== 'object') continue
    const { id, name, added, seen } = entry as Record<string, unknown>
    const [deviceId, deviceName, addedAt, seenAt] = [text(id), text(name), text(added), text(seen)]
    if (deviceId && deviceName && addedAt) rows.push({ id: deviceId, name: deviceName, added: addedAt, ...(seenAt ? { seen: seenAt } : {}) })
  }
  const why = text(problem)
  return { on, listening: listening === true, ...(why ? { problem: why } : {}), devices: rows }
}

function readLink(output: unknown): AddLink | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { url, numberUrl, expires } = output as Record<string, unknown>
  const [link, byNumber, until] = [text(url), text(numberUrl), text(expires)]
  return link && until ? { url: link, ...(byNumber ? { numberUrl: byNumber } : {}), expires: until } : undefined
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

export const loadStatus = (host: ModuleHost, projects: ModuleProject[]): Promise<Answer<DoorStatus>> => run(host, projects, ['status'], readStatus)
export const setSwitch = (host: ModuleHost, projects: ModuleProject[], on: boolean): Promise<Answer<DoorStatus>> => run(host, projects, [on ? 'on' : 'off'], readStatus)
export const addDevice = (host: ModuleHost, projects: ModuleProject[]): Promise<Answer<AddLink>> => run(host, projects, ['add'], readLink)
export const removeDevice = (host: ModuleHost, projects: ModuleProject[], id: string): Promise<Answer<DoorStatus>> => run(host, projects, ['remove', id], readStatus)

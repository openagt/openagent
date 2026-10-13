import type { ModuleHost } from '@openagt/dashboard/module'

// What the section shows: the answer of `remote-access status`, read forgivingly, and the three
// things a person does, each one of the package's own commands. The devices are this computer's,
// not a project's: each command runs in no project, so the section is there with no project added.

/** A phone or a browser that is in. */
export interface DeviceRow {
  id: string
  name: string
  added: string
  seen?: string
  /** A computer that keeps a line open here: this server starts runs on it. */
  line?: true
  /** A computer is one row: the ids of what else it holds here, its line beside its key for OpenAgent. */
  also?: string[]
}

/** Every id a row is listed under. */
export const idsOf = (device: Pick<DeviceRow, 'id' | 'also'>): string[] => [device.id, ...(device.also ?? [])]

/** The door as `status` tells it. */
export interface DoorStatus {
  on: boolean
  listening: boolean
  problem?: string
  /** On a server: the address its door is open at, over HTTPS, to every network. */
  https?: { address: string }
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
  const { on, listening, problem, https, devices } = output as Record<string, unknown>
  if (typeof on !== 'boolean' || !Array.isArray(devices)) return undefined
  const rows: DeviceRow[] = []
  for (const entry of devices) {
    if (!entry || typeof entry !== 'object') continue
    const { id, name, added, seen, line, also } = entry as Record<string, unknown>
    const [deviceId, deviceName, addedAt, seenAt] = [text(id), text(name), text(added), text(seen)]
    const others = Array.isArray(also) ? also.filter((other): other is string => typeof other === 'string' && other !== '') : []
    if (deviceId && deviceName && addedAt) rows.push({ id: deviceId, name: deviceName, added: addedAt, ...(seenAt ? { seen: seenAt } : {}), ...(line === true ? { line: true } : {}), ...(others.length ? { also: others } : {}) })
  }
  const why = text(problem)
  const address = https && typeof https === 'object' ? text((https as Record<string, unknown>).address) : undefined
  return { on, listening: listening === true, ...(why ? { problem: why } : {}), ...(address ? { https: { address } } : {}), devices: rows }
}

function readLink(output: unknown): AddLink | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { url, numberUrl, expires } = output as Record<string, unknown>
  const [link, byNumber, until] = [text(url), text(numberUrl), text(expires)]
  return link && until ? { url: link, ...(byNumber ? { numberUrl: byNumber } : {}), expires: until } : undefined
}

async function run<T>(host: ModuleHost, args: string[], read: (output: unknown) => T | undefined): Promise<Answer<T>> {
  const result = await host.runComputerCommand(args).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
  if (!result.ok) return result
  const value = read(result.output)
  return value !== undefined ? { ok: true, value } : { ok: false, error: 'the command answered something else than expected' }
}

export const loadStatus = (host: ModuleHost): Promise<Answer<DoorStatus>> => run(host, ['status'], readStatus)
export const setSwitch = (host: ModuleHost, on: boolean): Promise<Answer<DoorStatus>> => run(host, [on ? 'on' : 'off'], readStatus)
export const addDevice = (host: ModuleHost): Promise<Answer<AddLink>> => run(host, ['add'], readLink)
export const removeDevice = (host: ModuleHost, id: string): Promise<Answer<DoorStatus>> => run(host, ['remove', id], readStatus)

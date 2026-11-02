import { execFile } from 'node:child_process'
import { readFile, statfs } from 'node:fs/promises'
import { cpus, freemem, homedir, platform, totalmem } from 'node:os'
import { promisify } from 'node:util'

// How a computer stands: how much of its memory and of its disk is in use, and how busy it is. A
// computer says its own in the ping another computer of the person's reads (`relay-endpoints.ts`):
// the Overview's Devices card shows it for this computer and for each server, so a full disk or a
// server out of memory is seen before an agent fails on it.

const run = promisify(execFile)

/** A computer's memory, disk and load, as it says them. */
export interface Health {
  /** Memory, in bytes: all of it, and how much is in use, the cache a system gives back on demand not counted. */
  memory: { total: number; used: number }
  /** The disk of its user's home, in bytes: all of it, and how much is in use. */
  disk?: { total: number; used: number }
  /** How busy its processors are, in percent of all of them: the time they were not idle since the reading before. */
  load?: number
}

/**
 * The memory a computer can still give: what Linux calls available, free plus the cache it drops
 * on demand; on a Mac, the free, inactive and purgeable pages; elsewhere, what is free. A plain
 * "free" read as nearly full on both, where most of it is cache.
 */
async function availableMemory(): Promise<number> {
  if (platform() === 'linux') {
    const said = await readFile('/proc/meminfo', 'utf8').catch(() => '')
    const kb = /^MemAvailable:\s+(\d+) kB$/m.exec(said)?.[1]
    if (kb !== undefined) return Number(kb) * 1024
  }
  if (platform() === 'darwin') {
    const { stdout } = await run('vm_stat', [], { timeout: 2000 }).catch(() => ({ stdout: '' }))
    const page = Number(/page size of (\d+) bytes/.exec(stdout)?.[1] ?? 0)
    const pages = (name: string): number => Number(new RegExp(`^${name}:\\s+(\\d+)\\.`, 'm').exec(stdout)?.[1] ?? 0)
    const free = page * (pages('Pages free') + pages('Pages inactive') + pages('Pages purgeable'))
    if (free > 0) return free
  }
  return freemem()
}

/** The processors' time so far, busy and in all, in ms: what two readings tell how busy they were between. */
function cpuTimes(): { busy: number; total: number } {
  let busy = 0
  let total = 0
  for (const cpu of cpus()) {
    const { user, nice, sys, irq, idle } = cpu.times
    busy += user + nice + sys + irq
    total += user + nice + sys + irq + idle
  }
  return { busy, total }
}

/** The times of the reading before, and when: how busy the processors were is said over the time since. */
let lastTimes: { busy: number; total: number; at: number } | undefined

/** A reading older than this is no measure of now: the processors are watched afresh. */
const STALE_MS = 60_000

/** How long the first reading watches the processors, with none before it to compare with. */
const FIRST_LOOK_MS = 500

/**
 * How busy the processors were, in percent of all of them, since the reading before (with none
 * in the last minute, over half a second). Not the load average: that counts the programs waiting on the disk
 * too, and fades over minutes, so a server idle now read as full long after an install.
 */
async function cpuBusy(): Promise<number | undefined> {
  let before: { busy: number; total: number } | undefined = lastTimes && Date.now() - lastTimes.at < STALE_MS ? lastTimes : undefined
  if (!before) {
    before = cpuTimes()
    await new Promise(resolve => setTimeout(resolve, FIRST_LOOK_MS))
  }
  const now = cpuTimes()
  lastTimes = { ...now, at: Date.now() }
  const total = now.total - before.total
  return total > 0 ? Math.round(((now.busy - before.busy) / total) * 100) : undefined
}

/** How long a reading is kept: a ping is asked every few seconds, and `vm_stat` is a process each time. */
const KEPT_MS = 15_000
let kept: { at: number; health: Promise<Health> } | undefined

/** This computer's health, read at most every {@link KEPT_MS}. */
export function computerHealth(now: number = Date.now()): Promise<Health> {
  if (kept && now - kept.at < KEPT_MS) return kept.health
  const health = (async (): Promise<Health> => {
    const total = totalmem()
    const memory = { total, used: Math.max(0, total - (await availableMemory())) }
    const fs = await statfs(homedir()).catch(() => undefined)
    const disk = fs ? { total: fs.blocks * fs.bsize, used: (fs.blocks - fs.bavail) * fs.bsize } : undefined
    const load = cpus().length === 0 ? undefined : await cpuBusy()
    return { memory, ...(disk ? { disk } : {}), ...(load !== undefined ? { load } : {}) }
  })()
  kept = { at: now, health }
  return health
}

/** What another computer said of its health, kept only as well-formed: whole, finite, used no more than all. */
export function readHealth(said: unknown): Health | undefined {
  if (typeof said !== 'object' || said === null) return undefined
  const part = (value: unknown): { total: number; used: number } | undefined => {
    const { total, used } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    return typeof total === 'number' && typeof used === 'number' && Number.isFinite(total) && Number.isFinite(used) && total > 0 && used >= 0 && used <= total ? { total, used } : undefined
  }
  const { memory, disk, load } = said as Record<string, unknown>
  const mem = part(memory)
  if (!mem) return undefined
  const space = part(disk)
  return { memory: mem, ...(space ? { disk: space } : {}), ...(typeof load === 'number' && Number.isFinite(load) && load >= 0 && load <= 10_000 ? { load: Math.round(load) } : {}) }
}

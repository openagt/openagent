import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BRANCHES_DIR } from './names.js'

// The lock every process on one clone takes before it touches a branch's persistent checkout: a
// daemon, a scheduler and each run are separate processes, and one's `reset --hard` wipes the
// other's half-written change. A file created exclusively beside the checkout, holding the
// holder's pid; a holder that died is taken over, a live one is waited for. Within one process
// the tasks that ask for the same lock take it in the order they asked.

/** How long a process waits for another to let go of the checkout before it gives up. */
export const CHECKOUT_LOCK_WAIT_MS = 5 * 60_000
const POLL_MS = 100
/** A lock file still empty this long after it was made belongs to a process that died making it. */
const EMPTY_STALE_MS = 10_000

/** The lock file of a branch's persistent checkout: `<repo>/.branches/<branch>.lock`. */
export function checkoutLockPath(repo: string, branch: string): string {
  return join(repo, BRANCHES_DIR, `${branch}.lock`)
}

export interface CheckoutLockDeps {
  waitMs?: number
  isAlive?: (pid: number) => boolean
}

/** Whether a process with this pid is running on this machine. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: it exists, it is someone else's.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Run `task` holding the checkout's lock, and let go of it afterwards, whatever the task did: one
 * task at a time per repository and branch, so a writer and the eager pull never interleave.
 * Rejects without running the task when another live process holds the lock longer than the wait.
 */
export function withCheckoutLock<T>(repo: string, branch: string, deps: CheckoutLockDeps, task: () => Promise<T>): Promise<T> {
  return withLockFile(checkoutLockPath(repo, branch), deps, task)
}

/** The tasks of this process waiting for each lock, by its path, chained in the order they asked. */
const queues = new Map<string, Promise<unknown>>()

/**
 * The same lock at any path: what every writer of the personal folder takes. A task runs after
 * every task this process asked the same lock for before it, and holding the lock file, so no
 * other process runs one meanwhile.
 */
export function withLockFile<T>(path: string, deps: CheckoutLockDeps = {}, task: () => Promise<T>): Promise<T> {
  const run = () => holding(path, deps, task)
  const next = (queues.get(path) ?? Promise.resolve()).then(run, run)
  queues.set(path, next.catch(() => {}))
  return next
}

/** Run `task` holding the lock file: taken at once, waited for, or taken over from a dead holder. */
async function holding<T>(path: string, deps: CheckoutLockDeps, task: () => Promise<T>): Promise<T> {
  const token = `${process.pid} ${randomUUID()}`
  await acquire(path, token, deps.waitMs ?? CHECKOUT_LOCK_WAIT_MS, deps.isAlive ?? isPidAlive)
  try {
    return await task()
  } finally {
    await removeIfHeld(path, token)
  }
}

async function acquire(path: string, token: string, waitMs: number, isAlive: (pid: number) => boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      const file = await open(path, 'wx')
      try {
        await file.writeFile(token)
      } finally {
        await file.close()
      }
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const held = await readFile(path, 'utf8').catch(() => undefined)
    // Let go of between the two calls: try again at once.
    if (held === undefined) continue
    if (await isStale(path, held, isAlive)) {
      await removeIfHeld(path, held)
      continue
    }
    if (Date.now() >= deadline) throw new Error(`another process has held ${path} for longer than ${Math.round(waitMs / 1000)}s`)
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

/** A lock whose holder is gone: its pid is not running, or it stayed empty (its maker died writing it). */
async function isStale(path: string, held: string, isAlive: (pid: number) => boolean): Promise<boolean> {
  if (!held) {
    const made = await stat(path).then(s => s.mtimeMs, () => undefined)
    return made !== undefined && Date.now() - made > EMPTY_STALE_MS
  }
  const pid = Number(held.split(' ')[0])
  return Number.isInteger(pid) && pid > 0 && !isAlive(pid)
}

/** Remove the lock file only while it still holds `token`: never another holder's. */
async function removeIfHeld(path: string, token: string): Promise<void> {
  const held = await readFile(path, 'utf8').catch(() => undefined)
  if (held === token) await unlink(path).catch(() => {})
}

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pidAlive } from './process.js'

/**
 * The files this package keeps in the person's home folder, beside OpenAgent's own home file: the
 * door's, the servers', and who was last in at each server. More than one process writes each of
 * them (a command, the door's process, an install's), so every change is made under a lock; and a
 * file is written whole, for its owner alone: a reader never sees half a file.
 */

/** A file's path: beside OpenAgent's own home file, by the same rule. */
export function homeFile(env: NodeJS.ProcessEnv, name: string): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, name)
  return join(env.HOME ?? '', '.' + name)
}

/** Write `text` to `path` whole, for its owner alone: to a file of its own first, then renamed into place. */
export async function writeWhole(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, text, { mode: 0o600 })
  await rename(tmp, path)
}

/** How long a writer waits for the lock, and how old a lock is taken over whoever holds it: a change takes milliseconds. */
const LOCK_WAIT_MS = 5_000
const LOCK_OLD_MS = 30_000

/** Whether the lock is one left behind: its writer is gone, or it is far older than any change takes. */
async function leftBehind(lock: string): Promise<boolean> {
  const [held, age] = await Promise.all([readFile(lock, 'utf8').catch(() => undefined), stat(lock).then(s => Date.now() - s.mtimeMs, () => 0)])
  if (held === undefined) return false
  const pid = Number(held.split(':')[0])
  return age > LOCK_OLD_MS || !Number.isInteger(pid) || !pidAlive(pid)
}

/** Run `run` while no other writer holds the file at `path`; `name` says which file a writer waited for too long. */
export async function withLock<T>(path: string, name: string, run: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`
  // The writer's name on the lock: a writer never removes a lock that is not its own.
  const mine = `${process.pid}:${randomBytes(8).toString('hex')}`
  await mkdir(dirname(path), { recursive: true })
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      await writeFile(lock, mine, { flag: 'wx', mode: 0o600 })
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      // A writer that died holding the lock must not shut every later one out. Looked at twice,
      // so a lock another waiter just took over is not taken from it.
      if ((await leftBehind(lock)) && (await leftBehind(lock))) await rm(lock, { force: true })
      else if (Date.now() > deadline) throw new Error(`${name} is held by another writer`)
      else await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    return await run()
  } finally {
    if ((await readFile(lock, 'utf8').catch(() => undefined)) === mine) await rm(lock, { force: true })
  }
}

/** The file is there and cannot be read as what it should hold: a typo made by hand, a disk that failed. */
export class Unreadable extends Error {
  /** `kind` is what the file lists: a device, a server. */
  constructor(path: string, kind: string) {
    super(`${path} cannot be read: correct it, or delete it to start with no ${kind}`)
  }
}

/** A JSON file of the person's, which `sanitize` reads forgivingly: anything malformed in it is left out. */
export interface JsonFile<S> {
  path(env: NodeJS.ProcessEnv): string
  /** What the file holds; no file reads as a file with nothing in it, and a file that is there and cannot be read as `'unreadable'`. */
  read(env: NodeJS.ProcessEnv): Promise<S | 'unreadable'>
  /**
   * Change the file: read it, apply `change`, write it back, with no other writer in between.
   * `change` answers what the caller wants to know of the change. Throws {@link Unreadable} for a
   * file that is there and cannot be read: never written over, what a person typed wrong is theirs
   * to correct.
   */
  update<T>(env: NodeJS.ProcessEnv, change: (value: S) => T): Promise<T>
}

/** The JSON file `name` in the person's home folder, listing things of a `kind`: devices, servers. */
export function jsonFile<S>(name: string, kind: string, sanitize: (value: unknown) => S): JsonFile<S> {
  const path = (env: NodeJS.ProcessEnv): string => homeFile(env, name)
  const read = async (env: NodeJS.ProcessEnv): Promise<S | 'unreadable'> => {
    let text: string
    try {
      text = await readFile(path(env), 'utf8')
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT' ? sanitize(undefined) : 'unreadable'
    }
    try {
      const value: unknown = JSON.parse(text)
      return value && typeof value === 'object' && !Array.isArray(value) ? sanitize(value) : 'unreadable'
    } catch {
      return 'unreadable'
    }
  }
  return {
    path,
    read,
    update: (env, change) =>
      withLock(path(env), `the ${kind}s file`, async () => {
        const value = await read(env)
        if (value === 'unreadable') throw new Unreadable(path(env), kind)
        const answer = change(value)
        await writeWhole(path(env), JSON.stringify(sanitize(value), null, 2) + '\n')
        return answer
      }),
  }
}

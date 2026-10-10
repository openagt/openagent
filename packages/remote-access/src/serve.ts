import { stat } from 'node:fs/promises'
import { onOwnNetwork, type AddressDeps } from './address.js'
import { openDoor, type Door } from './door.js'
import { pidAlive, readStoreStrict, storePath, update } from './store.js'

/**
 * The door's process: it runs for as long as OpenAgent runs, and follows the file. With the
 * switch on it opens the door; with it off it listens on nothing. A device taken out of the file
 * loses what it still held open.
 */

export interface ServeOptions {
  env: NodeJS.ProcessEnv
  /** OpenAgent's own address on this computer. */
  target: string
  /** The door's port; the one after OpenAgent's own when unsaid, so it is the same at every start. */
  port?: number
  host?: string
  address?: AddressDeps
  /** Ends the process's work: the door is closed and the file says so. */
  signal: AbortSignal
  log?: (line: string) => void
  /** How often the file is looked at. */
  pollMs?: number
  /** After how long a door that could not be opened is tried again. */
  retryMs?: number
}

/** The door's port for an OpenAgent at `target`. */
export function doorPort(target: string): number {
  const url = new URL(target)
  return (Number(url.port) || 80) + 1
}

function whyNot(err: unknown, port: number): string {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EADDRINUSE') return `Port ${port} is taken by another program on this computer.`
  if (code === 'EACCES') return `This computer does not let OpenAgent listen on port ${port}.`
  return `The door could not be opened: ${err instanceof Error ? err.message : String(err)}`
}

/** Run until `signal` aborts. */
export async function serve(opts: ServeOptions): Promise<void> {
  const { env, signal } = opts
  const log = opts.log ?? (() => {})
  const port = opts.port ?? doorPort(opts.target)
  let door: Door | undefined
  let failedAt: number | undefined
  let stamp: string | undefined

  const reconcile = async (): Promise<void> => {
    const now = await stat(storePath(env)).then(s => `${s.mtimeMs}:${s.size}`, () => 'none')
    const retry = failedAt !== undefined && Date.now() - failedAt > (opts.retryMs ?? 10_000)
    if (now === stamp && !retry) return
    stamp = now
    const store = await readStoreStrict(env)
    // A file that cannot be read is left as it is, and so is the door: it lets nobody in until the file reads again.
    if (store === 'unreadable') return log(`remote-access: ${storePath(env)} cannot be read; nobody gets in until it is corrected`)
    if (store.on && !door) {
      try {
        const knocks = opts.address
        door = await openDoor({ env, target: opts.target, port, ...(opts.host !== undefined ? { host: opts.host } : {}), ...(knocks ? { knocks: peer => onOwnNetwork(peer, knocks) } : {}) })
        failedAt = undefined
        log(`remote-access: the door is open on port ${door.port}`)
      } catch (err) {
        failedAt = Date.now()
        const problem = whyNot(err, port)
        // Another door's process holding the port (the one of an OpenAgent that just ended) is no
        // problem to tell: it goes by itself, and the door is tried again.
        const othersDoor = store.listening !== undefined && store.listening.pid !== process.pid && pidAlive(store.listening.pid)
        if (!othersDoor && store.problem !== problem) {
          await update(env, s => {
            delete s.listening
            s.problem = problem
          })
          log(`remote-access: ${problem}`)
        }
      }
    } else if (!store.on && (door || store.listening || store.problem)) {
      await door?.close()
      door = undefined
      failedAt = undefined
      await update(env, s => {
        delete s.listening
        delete s.problem
      })
      log('remote-access: the door is closed')
    }
    if (!door) return
    // Said in the file once the door is open, and again when a write of it failed: by this the command knows the door listens.
    if (store.on && (store.listening === undefined || !pidAlive(store.listening.pid))) {
      const listening = { pid: process.pid, port: door.port }
      // A write that failed is tried at the next look, not taken for a door that did not open.
      stamp = undefined
      await update(env, s => {
        s.listening = listening
        delete s.problem
      })
    }
    door.dropRemoved(store)
  }

  // One look at a time: a look that opens the door writes the file, which the next look reads.
  let looking: Promise<void> = Promise.resolve()
  const look = (): void => {
    looking = looking.then(reconcile).catch(err => log(`remote-access: ${err instanceof Error ? err.message : String(err)}`))
  }
  look()
  const timer = setInterval(look, opts.pollMs ?? 1_000)

  await new Promise<void>(resolve => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
  clearInterval(timer)
  await looking
  if (door) {
    await door.close()
    await update(env, s => {
      delete s.listening
    }).catch(() => {})
  }
}

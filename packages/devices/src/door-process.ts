import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * The door's own process, `devices serve`, run for as long as devices is on in OpenAgent: told
 * where OpenAgent answers on this computer (`OPENAGENT_URL`) and which computer this is
 * (`OPENAGENT_COMPUTER`). One that ends by itself is started again after a while. It is started in
 * a process group of its own, so a Ctrl-C in OpenAgent's terminal reaches OpenAgent alone, which
 * then ends it; one whose OpenAgent died without a word ends by itself (`serve`'s `withParent`).
 */

/** The `devices` command, whose `serve` is the door. */
const DEVICES_BIN = fileURLToPath(new URL('../bin/devices', import.meta.url))

export interface DoorProcessOptions {
  /** Where OpenAgent answers on this computer. */
  url: string
  /** Which computer this is, by the id other computers know it by. */
  computer?: string
  env: NodeJS.ProcessEnv
  log: (line: string) => void
  /** The command whose `serve` is run; the package's own `devices` when unsaid. */
  bin?: string
  /** After how long a door that ended by itself is started again. */
  restartMs?: number
}

export interface DoorProcess {
  /** End the door, and wait until it is gone. */
  stop(): Promise<void>
}

/** How long the door gets to end by itself once asked, before it is killed. */
const STOP_GRACE_MS = 3_000

export function startDoorProcess(opts: DoorProcessOptions): DoorProcess {
  const env = { ...opts.env, OPENAGENT_URL: opts.url, ...(opts.computer !== undefined ? { OPENAGENT_COMPUTER: opts.computer } : {}) }
  let stopping = false
  let running: ChildProcess | undefined
  let again: NodeJS.Timeout | undefined

  const start = (): void => {
    if (stopping) return
    const child = spawn(process.execPath, [opts.bin ?? DEVICES_BIN, 'serve'], { env, stdio: ['ignore', 'ignore', 'pipe'], detached: true })
    running = child
    child.stderr?.setEncoding('utf8').on('data', (said: string) => {
      for (const line of said.split('\n')) if (line.trim()) opts.log(line.trim())
    })
    const ended = (why: string): void => {
      if (running !== child) return
      running = undefined
      if (stopping) return
      opts.log(`devices: the door ended (${why}); it is started again shortly`)
      again = setTimeout(start, opts.restartMs ?? 5_000)
    }
    child.once('error', err => ended(err.message))
    child.once('exit', (code, signal) => ended(signal ?? `exit ${code}`))
  }
  start()

  return {
    async stop() {
      stopping = true
      if (again) clearTimeout(again)
      const child = running
      running = undefined
      if (!child || child.exitCode !== null || child.signalCode !== null) return
      await new Promise<void>(resolve => {
        const kill = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS)
        const gone = (): void => {
          clearTimeout(kill)
          resolve()
        }
        child.once('exit', gone)
        child.once('error', gone)
        child.kill('SIGTERM')
      })
    },
  }
}

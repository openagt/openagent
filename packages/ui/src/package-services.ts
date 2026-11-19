import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import type { ProvidedCommand } from '@openagt/agent-data'

/**
 * The services of OpenAgent's own packages: each declared command's `serve`, run as a process of
 * its own for as long as OpenAgent runs, and told where OpenAgent is (`OPENAGENT_URL`) and which
 * computer this is (`OPENAGENT_COMPUTER`), which the daemon puts in what it hands over. OpenAgent
 * knows nothing of what a service does. One that ends by itself is started again after a
 * while; all of them end with OpenAgent. Each is started in a process group of its own, so a
 * Ctrl-C in OpenAgent's terminal reaches OpenAgent alone, which then ends them in its own order.
 */

/** How a package of this computer is told which computer this is: the name of the word in what it is started with. */
export const COMPUTER_ENV = 'OPENAGENT_COMPUTER'

/** How a package of this computer is told where OpenAgent answers on it. */
export const URL_ENV = 'OPENAGENT_URL'

let ownUrl: string | undefined

/** Say where this OpenAgent answers, once it listens: what its packages' commands are told too. */
export function sayOwnUrl(url: string | undefined): void {
  ownUrl = url
}

/** Where this OpenAgent answers, as it was said; nothing before it listens. */
export function ownUrlSaid(): string | undefined {
  return ownUrl
}

export interface PackageServicesOptions {
  /** The commands to run, each a package's declared service. */
  commands: readonly ProvidedCommand[]
  /** OpenAgent's own address on this computer. */
  url: string
  env: NodeJS.ProcessEnv
  log: (line: string) => void
  /** How a service's process is started; the real one when unsaid. */
  spawn?: (bin: string, env: NodeJS.ProcessEnv) => ChildProcess
  /** After how long a service that ended by itself is started again. */
  restartMs?: number
}

export interface PackageServices {
  /** End every service, and wait until each is gone. */
  stop(): Promise<void>
}

/** How long a service gets to end by itself once asked, before it is killed. */
const STOP_GRACE_MS = 3_000

export function startPackageServices(opts: PackageServicesOptions): PackageServices {
  const spawn = opts.spawn ?? ((bin, env) => nodeSpawn(process.execPath, [bin, 'serve'], { env, stdio: ['ignore', 'ignore', 'pipe'], detached: true }))
  const env = { ...opts.env, [URL_ENV]: opts.url }
  let stopping = false
  const running = new Map<string, ChildProcess>()
  const timers = new Set<NodeJS.Timeout>()

  const start = (command: ProvidedCommand): void => {
    if (stopping) return
    const child = spawn(command.bin, env)
    running.set(command.package, child)
    child.stderr?.setEncoding('utf8').on('data', (said: string) => {
      for (const line of said.split('\n')) if (line.trim()) opts.log(line.trim())
    })
    const ended = (why: string): void => {
      if (running.get(command.package) !== child) return
      running.delete(command.package)
      if (stopping) return
      opts.log(`${command.package}: its service ended (${why}); it is started again shortly`)
      const timer = setTimeout(() => {
        timers.delete(timer)
        start(command)
      }, opts.restartMs ?? 5_000)
      timers.add(timer)
    }
    child.once('error', err => ended(err.message))
    child.once('exit', (code, signal) => ended(signal ?? `exit ${code}`))
  }
  for (const command of opts.commands) start(command)

  return {
    async stop() {
      stopping = true
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      await Promise.all(
        [...running.values()].map(
          child =>
            new Promise<void>(resolve => {
              if (child.exitCode !== null || child.signalCode !== null) return resolve()
              const kill = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS)
              child.once('exit', () => {
                clearTimeout(kill)
                resolve()
              })
              child.once('error', () => {
                clearTimeout(kill)
                resolve()
              })
              child.kill('SIGTERM')
            }),
        ),
      )
      running.clear()
    },
  }
}

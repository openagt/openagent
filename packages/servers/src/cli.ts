import { spawn } from 'node:child_process'
import { askLink, install } from './install.js'
import type { Exec } from './ssh.js'
import { STEPS } from './steps.js'
import { Unreadable, addressOf, freshSteps, isUser, isVersion, pidAlive, readStore, update, type Server, type StepState, type Store } from './store.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went: 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the other packages' commands, so a person and a dashboard read it the same way.
 */

export const USAGE = `usage: servers <command>

  status                               the servers this computer installed OpenAgent on, and how far each install is
  connect <address> <user> <version>   install OpenAgent at this version on the server at this number or name, logging in
                                       over SSH as this user (root, or one that becomes root without a password) with this
                                       computer's own SSH keys; run again, it goes on where it failed, and brings a server
                                       that fell behind to this version
  link <address>                       a link the server's door gives for a new machine, once, for five minutes
  added <address>                      the server is among OpenAgent's machines: nothing is left to add
  forget <address>                     take the server off this list; nothing is changed on the server
  work <address> <version>             the install's own process, started by connect`

export interface CliIO {
  env: NodeJS.ProcessEnv
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** How a command is run on a server; the real `ssh` when unsaid. */
  exec?: Exec
  /** Starts the install's own process and answers its id; a process of this command, apart from it, when unsaid. */
  startWork?: (address: string, version: string) => number
  /** Ends `work`; SIGINT and SIGTERM when unsaid. */
  signal?: AbortSignal
}

class Refused extends Error {}

/** A server as `status` tells it. */
export interface ServerStatus {
  address: string
  user: string
  /** What the server's key is known by, as SSH showed it when this computer first met it. */
  fingerprint?: string
  /** The install runs right now. */
  working: boolean
  /** The steps are to end with the server among the machines, and it has not been added yet. */
  adding: boolean
  steps: { id: string; label: string; state: StepState; said?: string }[]
}

export interface Status {
  servers: ServerStatus[]
}

const working = (server: Server): boolean => server.worker !== undefined && pidAlive(server.worker)

function statusOf(store: Store): Status {
  return {
    servers: store.servers.map(server => {
      const busy = working(server)
      return {
        address: server.address,
        user: server.user,
        ...(server.fingerprint ? { fingerprint: server.fingerprint } : {}),
        working: busy,
        adding: server.adding,
        steps: STEPS.map(({ id, label }) => {
          const step = server.steps.find(candidate => candidate.id === id)!
          // A step that still reads as running with no process behind it: the install died there.
          if (step.state === 'running' && !busy) return { id, label, state: 'failed' as const, said: 'The install stopped before this step ended.' }
          return { id, label, state: step.state, ...(step.said ? { said: step.said } : {}) }
        }),
      }
    }),
  }
}

/** The install's own process: this command again, apart from the one that started it, so it goes on when that one has answered. */
function startWork(address: string, version: string, env: NodeJS.ProcessEnv): number {
  const child = spawn(process.execPath, [process.argv[1]!, 'work', address, version], { env, stdio: 'ignore', detached: true })
  child.unref()
  if (child.pid === undefined) throw new Refused('the install could not be started')
  return child.pid
}

async function connect(io: CliIO, said: { address: string; user: string; version: string }): Promise<Status> {
  const address = addressOf(said.address)
  if (address === undefined) throw new Refused(`${said.address} is not a server's number or name`)
  if (!isUser(said.user)) throw new Refused(`${said.user} is not a user name`)
  if (!isVersion(said.version)) throw new Refused(`${said.version} is not a version of OpenAgent`)
  // Written before the install's process starts, which reads it; held under this command's own
  // name until that process has one, so two presses of the button are one install.
  await update(io.env, store => {
    const known = store.servers.find(server => server.address === address)
    if (known && working(known)) throw new Refused(`OpenAgent is being installed on ${address} right now`)
    const fresh: Server = { address, user: said.user, ...(known?.fingerprint ? { fingerprint: known.fingerprint } : {}), steps: freshSteps(), worker: process.pid, adding: true }
    if (known) Object.assign(known, fresh)
    else store.servers.unshift(fresh)
  })
  let worker: number | undefined
  try {
    worker = (io.startWork ?? ((a, v) => startWork(a, v, io.env)))(address, said.version)
  } finally {
    await update(io.env, store => {
      const server = store.servers.find(candidate => candidate.address === address)
      // The install's process puts its own name there as it starts: it may have, and may have ended already.
      if (!server || server.worker !== process.pid) return
      if (worker !== undefined && pidAlive(worker)) server.worker = worker
      else delete server.worker
    })
  }
  return statusOf(await readStore(io.env))
}

/** The saved server at what a person typed, or a refusal. */
async function saved(io: CliIO, said: string): Promise<Server> {
  const server = (await readStore(io.env)).servers.find(candidate => candidate.address === addressOf(said))
  if (!server) throw new Refused(`no server at ${said}`)
  return server
}

async function work(io: CliIO, address: string, version: string): Promise<void> {
  if (!isVersion(version)) throw new Refused(`${version} is not a version of OpenAgent`)
  const controller = new AbortController()
  const stop = (): void => controller.abort()
  if (io.signal) io.signal.addEventListener('abort', stop, { once: true })
  else {
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }
  try {
    if (io.signal?.aborted) stop()
    await install({ env: io.env, address: (await saved(io, address)).address, version, signal: controller.signal, ...(io.exec ? { exec: io.exec } : {}) })
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

export async function runCli(args: string[], io: CliIO): Promise<number> {
  const [command, ...rest] = args
  const print = (value: unknown): number => {
    io.stdout(JSON.stringify(value))
    return 0
  }
  try {
    switch (command) {
      case 'status':
        if (rest.length) break
        return print(statusOf(await readStore(io.env)))
      case 'connect': {
        const [address, user, version] = rest
        if (rest.length !== 3 || !address || !user || !version) break
        return print(await connect(io, { address, user, version }))
      }
      case 'link': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const server = await saved(io, address)
        if (working(server)) throw new Refused(`OpenAgent is being installed on ${server.address} right now`)
        const link = await askLink(server, io.exec ? { exec: io.exec } : {})
        if (!link.ok) throw new Refused(link.error)
        return print({ url: link.url, expires: link.expires })
      }
      case 'added': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const { address: at } = await saved(io, address)
        await update(io.env, store => {
          const server = store.servers.find(candidate => candidate.address === at)
          if (server) server.adding = false
        })
        return print(statusOf(await readStore(io.env)))
      }
      case 'forget': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const { address: at } = await saved(io, address)
        await update(io.env, store => {
          const server = store.servers.find(candidate => candidate.address === at)
          if (server && working(server)) throw new Refused(`OpenAgent is being installed on ${at} right now: wait until it ends`)
          store.servers = store.servers.filter(candidate => candidate.address !== at)
        })
        return print(statusOf(await readStore(io.env)))
      }
      case 'work': {
        const [address, version] = rest
        if (rest.length !== 2 || !address || !version) break
        await work(io, address, version)
        return 0
      }
      default:
    }
  } catch (err) {
    if (!(err instanceof Refused || err instanceof Unreadable)) throw err
    // The last line is the one a dashboard shows: a refusal of several lines ends with what to do.
    io.stderr(err.message)
    return 1
  }
  io.stderr(USAGE)
  return 2
}

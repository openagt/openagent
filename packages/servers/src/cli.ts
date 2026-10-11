import { spawn } from 'node:child_process'
import { AlreadyWorking, askLink, install } from './install.js'
import { AlreadyAtWork, changeLogin, ownGithubAccount, type Mint } from './logins.js'
import type { Exec } from './ssh.js'
import { STEPS } from './steps.js'
import { LOGIN_KINDS, Unreadable, addressOf, atWork, doorUrl, freshSteps, isUser, isVersion, readStore, update, working, type Login, type LoginKind, type Server, type StepState, type Store } from './store.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went: 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the other packages' commands, so a person and a dashboard read it the same way.
 */

export const USAGE = `usage: servers <command>

  status                               the servers this computer installed OpenAgent on, how far each install is, and
                                       which logins each was given
  connect <address> <user> <version> [github]
                                       install OpenAgent at this version on the server at this number or name, logging in
                                       over SSH as this user (root, or one that becomes root without a password) with this
                                       computer's own SSH keys; run again, it goes on where it failed, and brings a server
                                       that fell behind to this version; with "github", this computer's GitHub login is
                                       copied to the server once it is installed
  link <address>                       a link the server's door gives for a new machine, once, for five minutes
  added <address>                      the server is among OpenAgent's machines: nothing is left to add
  github                               the GitHub account gh is logged in to on this computer: whose login a copy would be,
                                       or why there is none to copy
  login <address> github               copy this computer's GitHub login to the server, over SSH
  login <address> claude               make a Claude login for the server: this computer's browser asks you once, the
                                       login lasts a year and goes to the server over SSH; this computer's own Claude
                                       login is never read; run again while the browser waits, it asks anew
  logout <address> github|claude       delete that login on the server; the login itself is not ended by this
  forget <address>                     take the server off this list; nothing is changed on the server
  work <address> <version>             the install's own process, started by connect
  login-work <address> github|claude   the process that gives the server a login, started by login
  logout-work <address> github|claude  the process that takes a login off the server, started by logout`

export interface CliIO {
  env: NodeJS.ProcessEnv
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** How a command is run, on a server and on this computer; the real one when unsaid. */
  exec?: Exec
  /** How a Claude login is made; Claude Code's own `setup-token` when unsaid. */
  mint?: Mint
  /** Starts this command again with these words, as a process of its own, and answers its id; a process apart from this one when unsaid. */
  startWork?: (words: string[]) => number
  /** Ends `work` and `login-work`; SIGINT and SIGTERM when unsaid. */
  signal?: AbortSignal
}

class Refused extends Error {}

/** One login of a server, as `status` tells it. The login itself is never told: this computer does not keep it. */
export interface LoginStatus {
  /** This computer put it on the server, and did not take it off since. */
  there: boolean
  /** It is being changed right now, or the install copies it at its end. */
  working: boolean
  /** Claude: this computer's browser waits for the person's yes, and nothing was sent yet. */
  asking?: boolean
  /** GitHub: the person asked for a copy, and it was not made yet. */
  wanted?: boolean
  /** GitHub: the account, as the server's own gh answered. */
  account?: string
  /** ISO 8601: when it was put there. */
  since?: string
  /** Claude: when it ends by itself, a year after it was made. */
  ends?: string
  /** Why the last try ended without a login. */
  said?: string
}

/** A server as `status` tells it. */
export interface ServerStatus {
  address: string
  /** Where the server's door answers: what OpenAgent's machines know it by. */
  url: string
  user: string
  /** What the server's key is known by, as SSH showed it when this computer first met it. */
  fingerprint?: string
  /** The install runs right now. */
  working: boolean
  /** The steps are to end with the server among the machines, and it has not been added yet. */
  adding: boolean
  steps: { id: string; label: string; state: StepState; said?: string }[]
  logins: Record<LoginKind, LoginStatus>
}

export interface Status {
  servers: ServerStatus[]
}

/** How long a Claude login lasts that was made for a server. */
const CLAUDE_LASTS_MS = 365 * 24 * 60 * 60_000

function loginOf(kind: LoginKind, login: Login | undefined, installing: boolean): LoginStatus {
  const there = login?.since !== undefined
  return {
    there,
    working: atWork(login?.worker) || (login?.wanted === true && installing),
    ...(login?.asking && atWork(login.worker) ? { asking: true } : {}),
    ...(login?.wanted ? { wanted: true } : {}),
    ...(login?.account ? { account: login.account } : {}),
    ...(there ? { since: login!.since! } : {}),
    ...(there && kind === 'claude' ? { ends: new Date(Date.parse(login!.since!) + CLAUDE_LASTS_MS).toISOString() } : {}),
    ...(login?.failed ? { said: login.failed } : {}),
  }
}

function statusOf(store: Store): Status {
  return {
    servers: store.servers.map(server => {
      const busy = working(server)
      return {
        address: server.address,
        url: doorUrl(server.address),
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
        logins: { github: loginOf('github', server.github, busy), claude: loginOf('claude', server.claude, busy) },
      }
    }),
  }
}

/** This command again, as a process apart from the one that started it, so it goes on when that one has answered. */
function startWork(words: string[], env: NodeJS.ProcessEnv): number {
  const child = spawn(process.execPath, [process.argv[1]!, ...words], { env, stdio: 'ignore', detached: true })
  // A process that could not start has no number: told below, not thrown from here later.
  child.once('error', () => {})
  child.unref()
  if (child.pid === undefined) throw new Refused('the work could not be started')
  return child.pid
}

async function connect(io: CliIO, said: { address: string; user: string; version: string; github: boolean }): Promise<Status> {
  const address = addressOf(said.address)
  if (address === undefined) throw new Refused(`${said.address} is not a server's number or name`)
  if (!isUser(said.user)) throw new Refused(`${said.user} is not a user name`)
  if (!isVersion(said.version)) throw new Refused(`${said.version} is not a version of OpenAgent`)
  // Written before the install's process starts, which reads it; held under this command's own
  // name until that process has one, so two presses of the button are one install.
  await update(io.env, store => {
    const known = store.servers.find(server => server.address === address)
    if (known && working(known)) throw new Refused(`OpenAgent is being installed on ${address} right now`)
    if (known && changing(known)) throw new Refused(`A login of ${address} is being changed right now: wait until it ends`)
    const fresh: Server = { address, user: said.user, ...(known?.fingerprint ? { fingerprint: known.fingerprint } : {}), steps: freshSteps(), worker: { pid: process.pid, seen: new Date().toISOString() }, adding: true }
    if (known) Object.assign(known, fresh)
    else store.servers.unshift(fresh)
    // The person's tick, as it is at this press, kept until the install's end, where the copy is made.
    const server = store.servers.find(candidate => candidate.address === address)!
    const { since, account } = server.github ?? {}
    if (since || said.github) server.github = { ...(since ? { since } : {}), ...(account ? { account } : {}), ...(said.github ? { wanted: true } : {}) }
    else delete server.github
  })
  let worker: number | undefined
  try {
    worker = (io.startWork ?? (words => startWork(words, io.env)))(['work', address, said.version])
  } finally {
    await update(io.env, store => {
      const server = store.servers.find(candidate => candidate.address === address)
      // The install's process puts its own name there as it starts: it may have, and may have ended already.
      if (!server || server.worker?.pid !== process.pid) return
      if (worker !== undefined) server.worker = { pid: worker, seen: new Date().toISOString() }
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

/** The saved server, when nothing is being done to it that a login would get in the way of. */
async function still(io: CliIO, said: string): Promise<Server> {
  const server = await saved(io, said)
  if (working(server)) throw new Refused(`OpenAgent is being installed on ${server.address} right now`)
  return server
}

const isKind = (said: string | undefined): said is LoginKind => (LOGIN_KINDS as readonly string[]).includes(said ?? '')

/** Whether one of the server's logins is being changed right now. */
const changing = (server: Server): boolean => LOGIN_KINDS.some(kind => atWork(server[kind]?.worker))

/**
 * Start the process that changes one login of a server: gives it one, or takes it off. A login
 * that is being changed is not changed a second time, with one exception: a Claude login that
 * still waits for the person is ended and asked for anew, since a second press is the person
 * starting over, with a browser page that was closed.
 */
async function changeLoginOf(io: CliIO, said: string, kind: LoginKind, remove: boolean): Promise<Status> {
  const { address } = await still(io, said)
  const before = await update(io.env, store => {
    const server = store.servers.find(candidate => candidate.address === address)!
    const login = server[kind]
    const busy = atWork(login?.worker)
    if (busy && (remove || login!.asking !== true)) throw new Refused(new AlreadyAtWork(address, kind).message)
    server[kind] = { ...(login?.since ? { since: login.since } : {}), ...(login?.account ? { account: login.account } : {}), worker: { pid: process.pid, seen: new Date().toISOString() } }
    return busy ? login!.worker!.pid : undefined
  })
  if (before !== undefined) {
    try {
      process.kill(before, 'SIGTERM')
    } catch {
      // Ended by itself in the meantime.
    }
  }
  let worker: number | undefined
  try {
    worker = (io.startWork ?? (words => startWork(words, io.env)))([remove ? 'logout-work' : 'login-work', address, kind])
  } finally {
    await update(io.env, store => {
      const login = store.servers.find(candidate => candidate.address === address)?.[kind]
      if (!login || login.worker?.pid !== process.pid) return
      if (worker !== undefined) login.worker = { pid: worker, seen: new Date().toISOString() }
      else delete login.worker
    })
  }
  return statusOf(await readStore(io.env))
}

/** Run `work` until it ends, or until this process is told to stop. */
async function untilStopped(io: CliIO, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController()
  const stop = (): void => controller.abort()
  if (io.signal) io.signal.addEventListener('abort', stop, { once: true })
  else {
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }
  try {
    if (io.signal?.aborted) stop()
    await work(controller.signal)
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
  const over = { env: io.env, ...(io.exec ? { exec: io.exec } : {}) }
  try {
    switch (command) {
      case 'status':
        if (rest.length) break
        return print(statusOf(await readStore(io.env)))
      case 'connect': {
        const [address, user, version, github] = rest
        if (rest.length < 3 || rest.length > 4 || !address || !user || !version || (rest.length === 4 && github !== 'github')) break
        return print(await connect(io, { address, user, version, github: github === 'github' }))
      }
      case 'link': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const link = await askLink(await still(io, address), io.exec ? { exec: io.exec } : {})
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
      case 'github': {
        if (rest.length) break
        // Nobody's is an answer too, with why: a page asks this to know what it can offer.
        const own = await ownGithubAccount(io.exec)
        return print(own.ok ? { account: own.account } : { problem: own.error })
      }
      case 'login':
      case 'logout': {
        const [address, kind] = rest
        if (rest.length !== 2 || !address || !isKind(kind)) break
        return print(await changeLoginOf(io, address, kind, command === 'logout'))
      }
      case 'forget': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const { address: at } = await saved(io, address)
        await update(io.env, store => {
          const server = store.servers.find(candidate => candidate.address === at)
          if (server && working(server)) throw new Refused(`OpenAgent is being installed on ${at} right now: wait until it ends`)
          if (server && changing(server)) throw new Refused(`A login of ${at} is being changed right now: wait until it ends`)
          store.servers = store.servers.filter(candidate => candidate.address !== at)
        })
        return print(statusOf(await readStore(io.env)))
      }
      case 'work': {
        const [address, version] = rest
        if (rest.length !== 2 || !address || !version) break
        if (!isVersion(version)) throw new Refused(`${version} is not a version of OpenAgent`)
        const { address: at } = await saved(io, address)
        await untilStopped(io, signal => install({ ...over, address: at, version, signal }))
        return 0
      }
      case 'login-work':
      case 'logout-work': {
        const [address, kind] = rest
        if (rest.length !== 2 || !address || !isKind(kind)) break
        const { address: at } = await saved(io, address)
        await untilStopped(io, signal => changeLogin({ ...over, address: at, kind, remove: command === 'logout-work', signal, ...(io.mint ? { mint: io.mint } : {}) }))
        return 0
      }
      default:
    }
  } catch (err) {
    if (!(err instanceof Refused || err instanceof Unreadable || err instanceof AlreadyWorking || err instanceof AlreadyAtWork)) throw err
    io.stderr(err.message)
    return 1
  }
  io.stderr(USAGE)
  return 2
}

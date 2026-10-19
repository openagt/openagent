import { spawn } from 'node:child_process'
import { idsOf, isDeviceId, nameOwner, readDevices, removeDevice, removePerson, type Devices, type ServerDevice, type ServerPerson } from './devices.js'
import { AlreadyWorking, askLink, install } from './install.js'
import { AlreadyAtWork, changeLogin, ownGithubAccount, type Mint } from './logins.js'
import { ownDoor, type OwnDoor } from './own-door.js'
import { OwnAtWork, askOwnGithub, giveOwnClaude, giveOwnGithub, personHere, removeOwn, startOverSoon, startOwnGithubCode } from './own.js'
import { copyGithub, copyGithubToOther, forgetShared, isOtherUrl, isSharedUrl, lineTo, mintFor, otherLogins, setSharedReach, startMint } from './shared.js'
import type { Exec } from './ssh.js'
import { SERVER_MARK, STEPS } from './steps.js'
import { LOGIN_KINDS, Unreadable, addressOf, isAccount, isServerName, atWork, doorUrl, freshSteps, isUser, isVersion, readStore, update, working, type Login, type LoginKind, type Reach, type Server, type StepState, type Store } from './store.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went: 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the other packages' commands, so a person and a dashboard read it the same way.
 */

export const USAGE = `usage: servers <command>

  status                               the servers this computer installed OpenAgent on, how far each install is, and
                                       which logins each was given; and whether this computer is itself such a server
  connect <address> <user> <version> [github]
                                       install OpenAgent at this version on the server at this number or name, logging in
                                       over SSH as this user (root, or one that becomes root without a password) with this
                                       computer's own SSH keys; run again, it goes on where it failed, and brings a server
                                       that fell behind to this version; with "github", this computer's GitHub login is
                                       copied to the server once it is installed
  link <address> [--for <account>]     a link the server's door gives for a new machine, once, for five minutes; with
                                       --for, for a person's device, by their GitHub account (the owner is named first)
  owner <address> <account>            name the server's owner at its door, once, by their GitHub account
  added <address>                      the server is among OpenAgent's machines: nothing is left to add
  devices <address>                    the devices that are in on the server, as its door lists them, asked over SSH; the
                                       line this computer keeps open to the server is marked as its own
  remove-device <address> <id>         take one device out on the server, by its id as devices names it: it is out at once
  remove-person <address> <account>    take a person out on the server, with every device of theirs; the owner stays
  github                               the GitHub account gh is logged in to on this computer: whose login a copy would be,
                                       or why there is none to copy
  login <address> github               copy this computer's GitHub login to the server, over SSH
  login <address> github own           have the server get a GitHub login of its own: GitHub gives a code, status tells
                                       it, and you type it at github.com/login/device; run again while it waits, it
                                       asks anew
  login <address> claude               make a Claude login for the server: this computer's browser asks you once, the
                                       login lasts a year and goes to the server over SSH; this computer's own Claude
                                       login is never read; run again while the browser waits, it asks anew
  logout <address> github|claude       delete that login on the server; the login itself is not ended by this
  reach <address> full|watch           keep a line open from this computer to the server, so the server's page can start a
                                       run here (full), or can only see this computer's runs (watch)
  forget <address>                     take the server off this list, and the line this computer keeps to it; nothing else
                                       is changed on the server
  work <address> <version>             the install's own process, started by connect
  login-work <address> github|claude [own]
                                       the process that gives the server a login, started by login
  logout-work <address> github|claude  the process that takes a login off the server, started by logout

On a computer several people use, where this OpenAgent is one person's (OPENAGENT_PERSON names them):
  own                                  this OpenAgent's own GitHub and Claude logins
  own login github [--from <server>]   log in to GitHub with the login given on standard input; it must be the person's own;
                                       --from names the server whose OpenAgent of the same person copied it
  own login github own                 log in to GitHub with a code GitHub gives: own tells it, and the person types it at
                                       github.com/login/device
  own login claude [--from <server>]   log in to Claude with the login given on standard input; OpenAgent starts again with it
  own logout github|claude             delete that login here
  own-work github                      the process that waits for the code to be typed, started by own login github own

On this computer, for a server someone invited this computer's person to (by its address among the machines):
  shared <url>...                      what this computer keeps for each: its line there, and the Claude login it makes
  shared-login <url> github            copy this computer's GitHub login to the person's own OpenAgent there
  shared-login <url> claude            make a Claude login for it in this computer's browser, and hand it over
  shared-reach <url> full|watch|off    keep a line open to the server as this person's, and say what it may do; or none
  shared-forget <url>                  forget the server here, and the line to it
  shared-work <url>                    the process that makes the Claude login, started by shared-login

On this computer, for another person's computer shared with everyone on a server this computer's person is in at:
  other <url>...                       the person's logins there, as it says, and the Claude login this computer makes for it
  other-login <url> github             copy this computer's GitHub login there, in place of the server's copy
  other-login <url> claude             make a Claude login for it in this computer's browser, and hand it over
  other-work <url>                     the process that makes the Claude login, started by other-login`

export interface CliIO {
  env: NodeJS.ProcessEnv
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** How a command is run, on a server and on this computer; the real one when unsaid. */
  exec?: Exec
  /** How a Claude login is made; Claude Code's own `setup-token` when unsaid. */
  mint?: Mint
  /** How this computer's own door is asked; its command when unsaid. */
  door?: OwnDoor
  /** Starts this command again with these words, as a process of its own, and answers its id; a process apart from this one when unsaid. */
  startWork?: (words: string[]) => number
  /** Ends `work` and `login-work`; SIGINT and SIGTERM when unsaid. */
  signal?: AbortSignal
  /** What was handed to the command on standard input; the process's own when unsaid. */
  stdin?: () => Promise<string>
  /** Starts this OpenAgent again a moment after the command answered, once a Claude login of its own changed; the computer's service when unsaid. */
  startOver?: () => void
}

/** All of the process's standard input, as text. */
async function ownStdin(): Promise<string> {
  let said = ''
  for await (const chunk of process.stdin.setEncoding('utf8')) said += chunk
  return said
}

/** What `own` answers: whose OpenAgent this is, and its own logins. */
export interface OwnStatus {
  person: string
  logins: Record<LoginKind, LoginStatus>
}

/** What `shared` answers of one server: the line this computer keeps there, and the Claude login it makes for it. */
/** What `other` answers of another person's computer: the person's logins there, as it says them, and the Claude login this computer makes for it. */
export interface OtherStatus {
  url: string
  /** What that computer said of the logins there; nothing when it could not be asked. */
  logins?: unknown
  /** Why it could not be asked. */
  error?: string
  claude: LoginStatus
}

export interface SharedStatus {
  url: string
  reach?: Reach
  /** The server said no to the key the line is asked for with. */
  lineRefused?: true
  /** The id the line has among the server's devices. */
  line?: string
  claude: LoginStatus
}

class Refused extends Error {}

/** One login of a server, as `status` tells it. The login itself is never told: this computer does not keep it. */
export interface LoginStatus {
  /** This computer put it on the server, and did not take it off since. */
  there: boolean
  /** It is being changed right now, or the install copies it at its end. */
  working: boolean
  /** The change waits for the person: for a yes in this computer's browser (Claude), or for a code typed at GitHub. */
  asking?: boolean
  /** GitHub: the code the person types at github.com/login/device. */
  code?: string
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
  /** A login of this OpenAgent's own that was copied here: the server it came from. */
  from?: string
  /** The start of the login's SHA-256, for whoever copied it to tell whether its own is still the same. */
  mark?: string
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
  /** Set once this computer keeps a line open to the server: what the server may do through it. */
  reach?: Reach
  steps: { id: string; label: string; state: StepState; said?: string }[]
  logins: Record<LoginKind, LoginStatus>
}

export interface Status {
  servers: ServerStatus[]
  /** This computer is itself a server OpenAgent was installed on. */
  server?: true
}

/** How long a Claude login lasts that was made for a server. */
const CLAUDE_LASTS_MS = 365 * 24 * 60 * 60_000

function loginOf(kind: LoginKind, login: Login | undefined, installing: boolean): LoginStatus {
  const there = login?.since !== undefined
  return {
    there,
    working: atWork(login?.worker) || (login?.wanted === true && installing),
    ...(login?.asking && atWork(login.worker) ? { asking: true, ...(login.code ? { code: login.code } : {}) } : {}),
    ...(login?.wanted ? { wanted: true } : {}),
    ...(login?.account ? { account: login.account } : {}),
    ...(there ? { since: login!.since! } : {}),
    ...(there && kind === 'claude' ? { ends: new Date(Date.parse(login!.since!) + CLAUDE_LASTS_MS).toISOString() } : {}),
    ...(login?.failed ? { said: login.failed } : {}),
    ...(there && login!.from ? { from: login!.from } : {}),
    ...(there && login!.mark ? { mark: login!.mark } : {}),
  }
}

function statusOf(store: Store, env: NodeJS.ProcessEnv): Status {
  return {
    ...(env[SERVER_MARK] === '1' ? { server: true as const } : {}),
    servers: store.servers.map(server => {
      const busy = working(server)
      return {
        address: server.address,
        url: doorUrl(server.address),
        user: server.user,
        ...(server.fingerprint ? { fingerprint: server.fingerprint } : {}),
        working: busy,
        adding: server.adding,
        ...(server.reach ? { reach: server.reach } : {}),
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
  return statusOf(await readStore(io.env), io.env)
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

/**
 * Keep a line open from this computer to the server, and say what the server may do through it.
 * The first time, the server's door gives a link over SSH and this computer's own door gets in
 * with it; from then on only what the server may do is changed.
 */
async function setReach(io: CliIO, said: string, mode: Reach): Promise<Status> {
  const server = await still(io, said)
  const door = io.door ?? ownDoor
  // A line this computer already keeps is told what the server may do. One it lost since is asked for anew.
  const kept = server.reach !== undefined && (await door(['line', mode, server.address], io.env)).ok
  if (!kept) {
    const link = await askLink(server, io.exec ? { exec: io.exec } : {})
    if (!link.ok) throw new Refused(link.error)
    const asked = await door(['line', 'add', '-', ...(mode === 'watch' ? ['watch'] : [])], io.env, link.url)
    if (!asked.ok) throw new Refused(asked.error)
  }
  await update(io.env, store => {
    const saved = store.servers.find(candidate => candidate.address === server.address)
    if (saved) saved.reach = mode
  })
  return statusOf(await readStore(io.env), io.env)
}

/**
 * The line this computer keeps open to a server, as this computer's own door says: its id among
 * the server's devices, and whether the server said no to its key. `undefined` when this computer
 * keeps no line to that server, and when its door did not say. Asked of the door whatever this
 * package's own file says of a line: the door is the one that keeps it.
 */
async function ownLine(io: CliIO, server: Server): Promise<{ id?: string; refused: boolean } | undefined> {
  const answer = await (io.door ?? ownDoor)(['status'], io.env)
  if (!answer.ok || answer.out === undefined) return undefined
  try {
    const { lines } = JSON.parse(answer.out) as { lines?: unknown }
    const line = Array.isArray(lines) ? (lines as Record<string, unknown>[]).find(candidate => candidate?.url === doorUrl(server.address)) : undefined
    if (!line) return undefined
    return { ...(typeof line.id === 'string' && isDeviceId(line.id) ? { id: line.id } : {}), refused: line.refused === true }
  } catch {
    return undefined
  }
}

/** What `devices` and `remove-device` answer. */
export interface DevicesStatus {
  devices: ServerDevice[]
  /** The persons on the server, the owner first; none until the owner is named. */
  persons: ServerPerson[]
  /** The server said no to the key this computer asks for its line with: the line is to be asked for anew. */
  lineRefused?: true
}

/** The devices a server's door listed, with this computer's own line among them marked; a refusal for a server that did not say. */
function devicesOf(answer: Devices, line: { id?: string; refused: boolean } | undefined): DevicesStatus {
  if (!answer.ok) throw new Refused(answer.error)
  const own = line?.id
  return {
    devices: answer.devices.map(device => (device.line && own !== undefined && idsOf(device).includes(own) ? { ...device, own: true as const } : device)),
    persons: answer.persons,
    ...(line?.refused ? { lineRefused: true as const } : {}),
  }
}

const isKind = (said: string | undefined): said is LoginKind => (LOGIN_KINDS as readonly string[]).includes(said ?? '')

/** Whether one of the server's logins is being changed right now. */
const changing = (server: Server): boolean => LOGIN_KINDS.some(kind => atWork(server[kind]?.worker))

/**
 * Start the process that changes one login of a server: gives it one, or takes it off. A login
 * that is being changed is not changed a second time, with one exception: a login that
 * still waits for the person is ended and asked for anew, since a second press is the person
 * starting over, with a browser page that was closed or a code that ran out.
 */
async function changeLoginOf(io: CliIO, said: string, kind: LoginKind, remove: boolean, own = false): Promise<Status> {
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
    worker = (io.startWork ?? (words => startWork(words, io.env)))([remove ? 'logout-work' : 'login-work', address, kind, ...(own ? ['own'] : [])])
  } finally {
    await update(io.env, store => {
      const login = store.servers.find(candidate => candidate.address === address)?.[kind]
      if (!login || login.worker?.pid !== process.pid) return
      if (worker !== undefined) login.worker = { pid: worker, seen: new Date().toISOString() }
      else delete login.worker
    })
  }
  return statusOf(await readStore(io.env), io.env)
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

function ownStatusOf(store: Store, person: string): OwnStatus {
  return { person, logins: { github: loginOf('github', store.own?.github, false), claude: loginOf('claude', store.own?.claude, false) } }
}

/** The person this OpenAgent is; a refusal on any other computer. */
function person(io: CliIO): string {
  const account = personHere(io.env)
  if (account === undefined) throw new Refused('This OpenAgent is no person\'s on a computer several people use.')
  return account
}

async function sharedStatusOf(io: CliIO, urls: string[]): Promise<{ shared: SharedStatus[] }> {
  const store = await readStore(io.env)
  const door = io.door ?? ownDoor
  return {
    shared: await Promise.all(
      urls.map(async url => {
        const line = await lineTo(io.env, url, door)
        const claude = store.shared.find(kept => kept.url === url)?.claude
        // Only what this computer does here: whether the login is there is the server's to say.
        const { there: _there, since: _since, ends: _ends, ...making } = loginOf('claude', claude, false)
        return { url, ...(line ? { reach: line.mode, ...(line.refused ? { lineRefused: true as const } : {}), ...(line.id ? { line: line.id } : {}) } : {}), claude: { there: false, ...making } }
      }),
    ),
  }
}

async function otherStatusOf(io: CliIO, urls: string[]): Promise<{ other: OtherStatus[] }> {
  const store = await readStore(io.env)
  return {
    other: await Promise.all(
      urls.map(async url => {
        const said = await otherLogins(io.env, url)
        const { there: _there, since: _since, ends: _ends, ...making } = loginOf('claude', store.shared.find(kept => kept.url === url)?.claude, false)
        return { url, ...(said.ok ? { logins: said.output } : { error: said.error }), claude: { there: false, ...making } }
      }),
    ),
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
        return print(statusOf(await readStore(io.env), io.env))
      case 'connect': {
        const [address, user, version, github] = rest
        if (rest.length < 3 || rest.length > 4 || !address || !user || !version || (rest.length === 4 && github !== 'github')) break
        return print(await connect(io, { address, user, version, github: github === 'github' }))
      }
      case 'link': {
        const [address, flag, person] = rest
        if (!address || !(rest.length === 1 || (rest.length === 3 && flag === '--for' && person))) break
        if (person !== undefined && !isAccount(person)) throw new Refused(`${person} is not a GitHub account`)
        const link = await askLink(await still(io, address), io.exec ? { exec: io.exec } : {}, person?.toLowerCase())
        if (!link.ok) throw new Refused(link.error)
        return print({ url: link.url, expires: link.expires })
      }
      case 'owner':
      case 'remove-person': {
        const [address, account] = rest
        if (rest.length !== 2 || !address || !account) break
        const server = await still(io, address)
        const over = io.exec ? { exec: io.exec } : {}
        return print(devicesOf(await (command === 'owner' ? nameOwner : removePerson)(server, account, over), await ownLine(io, server)))
      }
      case 'devices': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const server = await still(io, address)
        return print(devicesOf(await readDevices(server, io.exec ? { exec: io.exec } : {}), await ownLine(io, server)))
      }
      case 'remove-device': {
        const [address, id] = rest
        if (rest.length !== 2 || !address || !id) break
        const server = await still(io, address)
        if (!isDeviceId(id)) throw new Refused(`${id} is not a device's id`)
        const line = await ownLine(io, server)
        const over = io.exec ? { exec: io.exec } : {}
        // Taken out there, the line would go on asking with a key that opens nothing: it is this computer's to end.
        // A computer is taken out whole, so the server is asked first which row the id is of.
        if (line?.id !== undefined) {
          const listed = await readDevices(server, over)
          if (!listed.ok) throw new Refused(listed.error)
          const row = listed.devices.find(device => idsOf(device).includes(id))
          if (id === line.id || (row !== undefined && idsOf(row).includes(line.id))) throw new Refused(`That device is the line this computer keeps open to ${server.address}. To take it out, remove the server here.`)
        }
        return print(devicesOf(await removeDevice(server, id, over), line))
      }
      case 'added': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const { address: at } = await saved(io, address)
        await update(io.env, store => {
          const server = store.servers.find(candidate => candidate.address === at)
          if (server) server.adding = false
        })
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'github': {
        if (rest.length) break
        // Nobody's is an answer too, with why: a page asks this to know what it can offer.
        const own = await ownGithubAccount(io.exec)
        return print(own.ok ? { account: own.account } : { problem: own.error })
      }
      case 'login':
      case 'logout': {
        const [address, kind, own] = rest
        // `own` is for a GitHub login alone, and only when one is given.
        const ownLogin = command === 'login' && kind === 'github' && own === 'own'
        if (rest.length !== (ownLogin ? 3 : 2) || !address || !isKind(kind)) break
        return print(await changeLoginOf(io, address, kind, command === 'logout', ownLogin))
      }
      case 'reach': {
        const [address, mode] = rest
        if (rest.length !== 2 || !address || (mode !== 'full' && mode !== 'watch')) break
        return print(await setReach(io, address, mode))
      }
      case 'forget': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const { address: at } = await saved(io, address)
        const reached = await update(io.env, store => {
          const server = store.servers.find(candidate => candidate.address === at)
          if (server && working(server)) throw new Refused(`OpenAgent is being installed on ${at} right now: wait until it ends`)
          if (server && changing(server)) throw new Refused(`A login of ${at} is being changed right now: wait until it ends`)
          store.servers = store.servers.filter(candidate => candidate.address !== at)
          return server?.reach !== undefined
        })
        // A server this computer no longer lists is not left a way to it. One that cannot be told keeps a key that opens nothing here.
        if (reached) await (io.door ?? ownDoor)(['line', 'remove', at], io.env)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'own': {
        const account = person(io)
        const own = { env: io.env, person: account, ...(io.exec ? { exec: io.exec } : {}) }
        const [what, kind, how, from] = rest
        if (rest.length === 0) return print(ownStatusOf(await readStore(io.env), account))
        // A login handed over may be a copy from the person's own OpenAgent on a server, which names that server.
        const copy = rest.length === 2 || (rest.length === 4 && how === '--from' && isServerName(from))
        const copiedFrom = rest.length === 4 ? from : undefined
        if (what === 'login' && kind === 'github' && rest.length === 3 && how === 'own') await startOwnGithubCode(own, io.startWork ?? (words => startWork(words, io.env)))
        else if (what === 'login' && kind === 'github' && copy) await giveOwnGithub(own, await (io.stdin ?? ownStdin)(), copiedFrom)
        else if (what === 'login' && kind === 'claude' && copy) {
          if (await giveOwnClaude(own, await (io.stdin ?? ownStdin)(), copiedFrom)) (io.startOver ?? startOverSoon)()
        } else if (what === 'logout' && isKind(kind) && rest.length === 2) {
          if (await removeOwn(own, kind)) (io.startOver ?? startOverSoon)()
        } else break
        return print(ownStatusOf(await readStore(io.env), account))
      }
      case 'own-work': {
        const [kind] = rest
        if (rest.length !== 1 || kind !== 'github') break
        const account = person(io)
        await untilStopped(io, signal => askOwnGithub({ env: io.env, person: account, signal, ...(io.exec ? { exec: io.exec } : {}) }))
        return 0
      }
      case 'shared': {
        if (rest.length === 0 || !rest.every(isSharedUrl)) break
        return print(await sharedStatusOf(io, rest))
      }
      case 'shared-login': {
        const [url, kind] = rest
        if (rest.length !== 2 || !isSharedUrl(url) || !isKind(kind)) break
        if (kind === 'claude') {
          await startMint(io.env, url, io.startWork ?? (words => startWork(words, io.env)))
          return print(await sharedStatusOf(io, [url]))
        }
        // What the server's OpenAgent said of its logins, after the copy.
        const copied = await copyGithub(io.env, url, io.exec)
        if (!copied.ok) throw new Refused(copied.error)
        return print(copied.output)
      }
      case 'shared-reach': {
        const [url, mode] = rest
        if (rest.length !== 2 || !isSharedUrl(url) || (mode !== 'full' && mode !== 'watch' && mode !== 'off')) break
        await setSharedReach(io.env, url, mode, io.door ?? ownDoor).catch((err: unknown) => {
          throw new Refused(err instanceof Error ? err.message : String(err))
        })
        return print(await sharedStatusOf(io, [url]))
      }
      case 'shared-forget': {
        const [url] = rest
        if (rest.length !== 1 || !isSharedUrl(url)) break
        await forgetShared(io.env, url, io.door ?? ownDoor).catch((err: unknown) => {
          throw new Refused(err instanceof Error ? err.message : String(err))
        })
        return print({ shared: [] })
      }
      case 'shared-work': {
        const [url] = rest
        if (rest.length !== 1 || !isSharedUrl(url)) break
        await untilStopped(io, signal => mintFor({ env: io.env, machine: url, signal, ...(io.mint ? { mint: io.mint } : {}) }))
        return 0
      }
      case 'other': {
        if (rest.length === 0 || !rest.every(isOtherUrl)) break
        return print(await otherStatusOf(io, rest))
      }
      case 'other-login': {
        const [url, kind] = rest
        if (rest.length !== 2 || !isOtherUrl(url) || !isKind(kind)) break
        if (kind === 'claude') await startMint(io.env, url, io.startWork ?? (words => startWork(words, io.env)), 'other')
        else {
          const copied = await copyGithubToOther(io.env, url, io.exec)
          if (!copied.ok) throw new Refused(copied.error)
        }
        return print(await otherStatusOf(io, [url]))
      }
      case 'other-work': {
        const [url] = rest
        if (rest.length !== 1 || !isOtherUrl(url)) break
        await untilStopped(io, signal => mintFor({ env: io.env, machine: url, to: 'other', signal, ...(io.mint ? { mint: io.mint } : {}) }))
        return 0
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
        const [address, kind, own] = rest
        const ownLogin = command === 'login-work' && kind === 'github' && own === 'own'
        if (rest.length !== (ownLogin ? 3 : 2) || !address || !isKind(kind)) break
        const { address: at } = await saved(io, address)
        await untilStopped(io, signal => changeLogin({ ...over, address: at, kind, remove: command === 'logout-work', own: ownLogin, signal, ...(io.mint ? { mint: io.mint } : {}) }))
        return 0
      }
      default:
    }
  } catch (err) {
    if (!(err instanceof Refused || err instanceof Unreadable || err instanceof AlreadyWorking || err instanceof AlreadyAtWork || err instanceof OwnAtWork)) throw err
    io.stderr(err.message)
    return 1
  }
  io.stderr(USAGE)
  return 2
}

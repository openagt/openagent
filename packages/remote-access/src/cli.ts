import { nameAddress, numberAddress, urlHost, type AddressDeps } from './address.js'
import { doorFingerprint } from './certificate.js'
import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { ENTER_PATH, readKeyWord } from './door.js'
import { askMe, enterForLine, leaveLine, readLineLink } from './line-out.js'
import { startPersonWork } from './persons.js'
import { HTTPS_PORT, serve } from './serve.js'
import { MAX_LINES, Unreadable, accountOf, addCode, addPerson, addressOf, computerWordFor, isComputerId, listedDevices, nameOwner, pidAlive, readStore, removeComputer, removePerson, update, type Line, type ListedDevice, type Store } from './store.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went: 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the other packages' commands, so a person and a dashboard read it the same way.
 */

export const USAGE = `usage: remote-access <command>

  status         whether Phone on Wi-Fi is on, whether the door listens, and the devices that are in
  on             Phone on Wi-Fi on: the door opens on the network this computer is on, over plain HTTP
  off            Phone on Wi-Fi off: nothing listens on the network; the devices stay in the list
  add [--for <account>]
                 a link a new device gets in with, once, for five minutes: the address a QR code holds; with --for,
                 the device is that person's, by their GitHub account (the owner is named first); where
                 OPENAGENT_PERSON_HELPER names the helper, the person gets a user and an OpenAgent of their own
  remove <id>    take one device out, by its id as status names it; it is out at once, a computer with all it holds here
  github         the GitHub account gh is logged in to on this computer: who the owner would be
  owner <account>
                 name this computer's owner, once, by their GitHub account: the devices already in are theirs
  remove-person <account>
                 take a person out, with every device of theirs, and their user with all it holds; the owner stays
  keep <account> keep a person a server's line made here, though that server no longer has them: nobody is asked about them again
  https <at>     this computer is a server, reached at this number or name: the door is open to every network,
                 over HTTPS, with a certificate it asks for and renews itself (ports 80 and 443 must be reachable)
  https off      no longer a server: Phone on Wi-Fi decides again
  line add <link> [watch]
                 keep a line open to a server, so a run can be started on this computer from the server's page;
                 the link is the one the server gives for a new device, or - to read it from standard input;
                 with watch the server only reads
  line full <at> only this computer's own person at the server at this number or name may start runs here through its line
  line everyone <at>
                 everyone at that server may, each as a user of their own here; only where OPENAGENT_PERSON_HELPER
                 names the helper, on a computer set up as a server
  line watch <at>
                 it may only read: this computer's runs are seen from the server's page, and none is started or told anything
  line remove <at>
                 no line to that server any more, and this computer's key for it there is taken out
  serve          the door's own process, run by OpenAgent for as long as it runs itself (OPENAGENT_URL says where OpenAgent is)`

export interface CliIO {
  env: NodeJS.ProcessEnv
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** How the computer's network is read; the real one when unsaid. */
  address?: AddressDeps
  /** Ends `serve`; SIGINT, SIGTERM and the end of the process that started it when unsaid. */
  signal?: AbortSignal
  /** How long `on` and `off` wait for the door's process to follow the switch, so the answer says how it went. */
  followMs?: number
  /** The address `serve` binds the door to; every network of this computer when unsaid. */
  host?: string
  /** What was handed to the command on standard input; the process's own when unsaid. */
  stdin?: () => Promise<string>
  /** How this computer gets in at a server for a line, and takes itself out; the real ones when unsaid. */
  enterForLine?: typeof enterForLine
  leaveLine?: typeof leaveLine
  /** How a server's door is asked who this computer's person is there; the real one when unsaid. */
  askMe?: typeof askMe
  /** The GitHub account `gh` is logged in to here; asked of `gh` when unsaid. */
  github?: () => Promise<{ ok: true; account: string } | { ok: false; error: string }>
  /** How the helper at `path` is run as root with `args`; with `sudo -n` when unsaid. */
  helper?: (path: string, args: string[]) => Promise<HelperAnswer>
  /** How the making of a person's user is started on its own, answering its process; this command again, detached, when unsaid. */
  startWork?: (env: NodeJS.ProcessEnv, account: string) => number | undefined
}

class Refused extends Error {}

/** What `status` answers. */
export interface Status {
  on: boolean
  /** The door's process holds the door open right now. */
  listening: boolean
  /** Why it does not, when it should, in words; on a server also why its certificate could not be renewed. */
  problem?: string
  /** On a server: the address the door is open at. */
  https?: { address: string }
  /**
   * Set on the OpenAgent of one person on a computer several people use, to their GitHub account:
   * that person's devices are in the owner's door, and this one's own file is not theirs.
   */
  person?: string
  /**
   * The devices that are in, a computer once: its key for OpenAgent and its line are one row,
   * under the first one's id, with the other's in `also`. A device with `line` is a computer that
   * keeps a line open here.
   */
  devices: ListedDevice[]
  /** The persons on this computer, by their GitHub account, the owner first; none until the owner is named. */
  persons: {
    account: string
    owner?: true
    /** On a computer that gives each person a user of their own: theirs is made, with their own OpenAgent. */
    ready?: true
    /** Theirs is being made right now. */
    working?: true
    /** Why theirs could not be made: asking for a code for them again tries again. */
    problem?: string
    /** The server whose line made them here, by its door. */
    from?: string
    /** That server no longer has them, or no longer lets this computer's line in: the owner is asked whether they stay. */
    removed?: true
    /** The owner said they stay all the same. */
    kept?: true
  }[]
  /**
   * The servers this computer keeps a line open to, what each may do through it, who there may
   * start runs here (`for`: everyone; only this computer's own person when absent), this
   * computer's person there, the id this computer has among that server's devices, and whether
   * the server said no to its key.
   */
  lines: { url: string; mode: Line['mode']; for?: 'everyone'; account?: string; id?: string; refused?: true }[]
}

const isListening = (store: Store): boolean => (store.on || store.https !== undefined) && store.listening !== undefined && pidAlive(store.listening.pid)

/** Why a door that should be open does not listen, when its own process said nothing: that process is not running. */
const NOT_RUNNING = 'The door opens once OpenAgent runs on this computer.'

/**
 * Whose OpenAgent this is, when it is one person's on a computer several people use: the person's
 * own, started for them beside the owner's. Their devices are in the owner's door, not here.
 */
function ownPerson(env: NodeJS.ProcessEnv): string | undefined {
  return env.OPENAGENT_PERSON ? accountOf(env.OPENAGENT_PERSON) : undefined
}

/**
 * Whether a person a server's line made here is no longer that server's: this computer keeps no
 * line to it, the server no longer lets the line in, or its door no longer lists them among its
 * persons. A line that is for only this computer's person again says nothing of them: they are
 * switched off here, not gone there.
 */
function goneFrom(store: Store, account: string, from: string): boolean {
  const line = store.lines.find(candidate => candidate.url === from)
  return !line || line.refused === true || (line.for === 'everyone' && line.persons !== undefined && !line.persons.includes(account))
}

function statusOf(store: Store, env: NodeJS.ProcessEnv): Status {
  const listening = isListening(store)
  const wanted = store.on || store.https !== undefined
  const problem = !wanted ? undefined : listening ? (store.https ? store.problem : undefined) : (store.problem ?? NOT_RUNNING)
  const person = ownPerson(env)
  return {
    on: store.on,
    listening,
    ...(problem ? { problem } : {}),
    ...(store.https ? { https: { address: store.https.address } } : {}),
    ...(person !== undefined ? { person } : {}),
    devices: listedDevices(store),
    persons: store.persons.map(({ account, owner, port, ready, problem, worker, from, kept }) => ({
      account,
      ...(owner ? { owner } : {}),
      // Only where the person gets a user of their own: how its making goes.
      ...(port !== undefined && ready ? { ready } : {}),
      ...(port !== undefined && worker !== undefined && pidAlive(worker) ? { working: true as const } : {}),
      ...(port !== undefined && problem !== undefined ? { problem } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(from !== undefined && goneFrom(store, account, from) ? { removed: true as const } : {}),
      ...(kept ? { kept } : {}),
    })),
    lines: store.lines.map(({ url, mode, for: who, account, key, refused }) => {
      const id = readKeyWord(key)?.id
      return { url, mode, ...(who ? { for: who } : {}), ...(account !== undefined ? { account } : {}), ...(id ? { id } : {}), ...(refused ? { refused: true as const } : {}) }
    }),
  }
}

async function setSwitch(io: CliIO, on: boolean): Promise<Status> {
  await update(io.env, store => {
    store.on = on
    if (!on) delete store.problem
  })
  const deadline = Date.now() + (io.followMs ?? 3_000)
  for (;;) {
    const store = await readStore(io.env)
    const settled = on ? isListening(store) || store.problem !== undefined : store.listening === undefined || !pidAlive(store.listening.pid)
    if (settled || Date.now() > deadline) return statusOf(store, io.env)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** On a server or off it: the file says which, and the answer waits a moment for the door's process to follow. */
async function setHttps(io: CliIO, address: string | undefined): Promise<Status> {
  await update(io.env, store => {
    if (address === undefined) delete store.https
    else store.https = { address }
    delete store.problem
    // Where the door listened until now is not where it will: its process says so anew.
    delete store.listening
  })
  const deadline = Date.now() + (io.followMs ?? 3_000)
  for (;;) {
    const store = await readStore(io.env)
    // A certificate takes longer than this waits for: the answer then says it is being asked for.
    const settled = address === undefined ? !isListening(store) || store.on : isListening(store) || store.problem !== undefined
    if (settled || Date.now() > deadline) return statusOf(store, io.env)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function addDevice(io: CliIO, said?: string): Promise<{ url: string; numberUrl?: string; expires: string; person?: string }> {
  const store = await readStore(io.env)
  const status = statusOf(store, io.env)
  // Asked once the door can give a link: a person's user is made on the way, which takes a while and is not undone.
  const whose = (): Promise<string | undefined> => (said === undefined ? Promise.resolve(undefined) : forPerson(io, store, said))
  if (store.https) {
    if (!status.listening) throw new Refused(status.problem ?? 'the door is not open')
    const fingerprint = await doorFingerprint(io.env)
    if (!fingerprint) throw new Refused('the door has no key yet')
    const person = await whose()
    const { code, expires } = await addCode(io.env, Date.now(), person)
    const port = store.listening!.port
    // After the code, what the door's key is known by: a computer that pastes the link knows the door again by it.
    return { url: `https://${urlHost(store.https.address)}${port === HTTPS_PORT ? '' : `:${port}`}${ENTER_PATH}#${code}.${fingerprint}`, expires, ...(person !== undefined ? { person } : {}) }
  }
  if (!status.on) throw new Refused('Phone on Wi-Fi is off: turn it on first')
  if (!status.listening) throw new Refused(status.problem ?? 'the door is not open')
  const port = store.listening!.port
  const name = await nameAddress(io.address)
  const number = numberAddress(io.address)
  const first = name ?? number
  if (!first) throw new Refused('this computer is on no network a device could reach it on')
  const person = await whose()
  const { code, expires } = await addCode(io.env, Date.now(), person)
  const link = (host: string): string => `http://${urlHost(host)}:${port}${ENTER_PATH}#${code}`
  // The number beside the name, for the phone that cannot open a name on the network.
  return { url: link(first), ...(name && number ? { numberUrl: link(number) } : {}), expires, ...(person !== undefined ? { person } : {}) }
}

/**
 * The person a code is for, by the GitHub account given: put among the persons when they are not
 * yet. `undefined` for the owner's own account: the device is the owner's, as with no `--for`.
 *
 * On a computer that gives each person a user of their own, the person gets a block of ports, and
 * the helper is started on its own to make their user, with their own OpenAgent on the first port
 * of the block. That takes a minute or two, longer than a page waits for a command, so the code is
 * answered at once and the file says how the making goes (`ready`, `problem`). Whoever gets in
 * with the code reaches that person's OpenAgent and no other, once it is up. Asked again for a
 * person whose user could not be made, the helper is started again.
 */
async function forPerson(io: CliIO, store: Store, said: string): Promise<string | undefined> {
  const account = accountOf(said)
  if (account === undefined) throw new Refused(`${said} is not a GitHub account`)
  const owner = store.persons.find(person => person.owner)
  if (!owner) throw new Refused('Name the owner first: remote-access owner <your GitHub account>')
  if (owner.account === account) return undefined
  const helper = helperOf(io)
  const person = await addPerson(io.env, account, Date.now(), helper !== undefined)
  if (!person) throw new Refused('This computer has as many persons as it can: remove one first.')
  if (helper && person.port !== undefined && !person.ready && !(person.worker !== undefined && pidAlive(person.worker))) {
    const worker = (io.startWork ?? startPersonWork)(io.env, account)
    await update(io.env, kept => {
      const known = kept.persons.find(candidate => candidate.account === account && !candidate.owner)
      if (!known) return
      delete known.problem
      if (worker !== undefined) known.worker = worker
    })
  }
  return account
}

/**
 * Make a person's user: the helper's work, run by the process {@link forPerson} started, which
 * writes in the file how it ended. Its words are written only while the file still names this
 * process as the person's: a person removed meanwhile, or asked for anew, is another's to say.
 */
async function personWork(io: CliIO, account: string): Promise<void> {
  const helper = helperOf(io)
  if (!helper) throw new Refused('OPENAGENT_PERSON_HELPER does not name the helper here')
  const person = (await readStore(io.env)).persons.find(candidate => candidate.account === account && !candidate.owner)
  if (person?.port === undefined) throw new Refused(`@${account} is no person here with a user to make`)
  // Another process at it already: it says how it ended.
  if (person.worker !== undefined && person.worker !== process.pid && pidAlive(person.worker)) return
  const mine = await update(io.env, kept => {
    const known = kept.persons.find(candidate => candidate.account === account && candidate.port === person.port)
    if (known) known.worker = process.pid
    return known !== undefined
  })
  if (!mine) return
  const made = await helper(['add', account, String(person.port)])
  await update(io.env, kept => {
    const known = kept.persons.find(candidate => candidate.account === account && candidate.worker === process.pid)
    if (!known) return
    delete known.worker
    if (made.ok) {
      known.ready = true
      delete known.problem
    } else {
      delete known.ready
      known.problem = made.error
    }
  })
}

/** End the process that makes a person's user, when one is at it, with the helper it started: their user is about to be removed. */
function stopWork(worker: number | undefined): void {
  if (worker === undefined || worker === process.pid || !pidAlive(worker)) return
  try {
    process.kill(-worker, 'SIGTERM')
  } catch {
    try {
      process.kill(worker, 'SIGTERM')
    } catch {
      // Gone already.
    }
  }
}

/** What the helper answered: done, or why not in its own last words. */
export type HelperAnswer = { ok: true } | { ok: false; error: string }

/** How long the helper may take: making a person's user installs Claude Code for them. */
const HELPER_TIMEOUT_MS = 10 * 60_000

/**
 * The helper that makes and removes each person's user on a computer that gives each person a
 * user of their own: a program of root's that this computer's user may run as root, and nothing
 * else (`OPENAGENT_PERSON_HELPER` names it). `undefined` on any other computer: there nothing is
 * made, and every person's calls go to the one OpenAgent, as before.
 */
function helperOf(io: CliIO): ((args: string[]) => Promise<HelperAnswer>) | undefined {
  const path = io.env.OPENAGENT_PERSON_HELPER
  if (!path) return undefined
  return io.helper ? args => io.helper!(path, args) : args => runHelper(path, args)
}

/** Run the helper as root, without a password: `sudo -n` says no at once where it would ask for one. */
function runHelper(path: string, args: string[]): Promise<HelperAnswer> {
  return new Promise(resolve => {
    execFile('sudo', ['-n', path, ...args], { timeout: HELPER_TIMEOUT_MS }, (err, _out, said) => {
      if (!err) return resolve({ ok: true })
      const last = String(said).trim().split('\n').at(-1)?.trim()
      resolve({ ok: false, error: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'sudo is not on this computer.' : err.killed ? 'it took too long.' : last || `it ended with ${err.code ?? 'an error'}.` })
    })
  })
}

/** The GitHub account `gh` is logged in to on this computer. */
function ghAccount(): Promise<{ ok: true; account: string } | { ok: false; error: string }> {
  return new Promise(resolve => {
    execFile('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '.login'], { timeout: 15_000 }, (err, out) => {
      const account = accountOf(String(out))
      if (!err && account !== undefined) return resolve({ ok: true, account })
      const missing = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
      resolve({ ok: false, error: missing ? 'GitHub\'s command, gh, is not on this computer: install it, then run gh auth login.' : 'gh is not logged in to github.com here: run gh auth login.' })
    })
  })
}

/** All of the process's standard input, as text. */
async function ownStdin(): Promise<string> {
  let said = ''
  for await (const chunk of process.stdin.setEncoding('utf8')) said += chunk
  return said
}

/** This computer's name as a server lists it. */
function ownName(): string {
  return hostname().replace(/\.local$/i, '') || 'A computer'
}

/** The line to the server a person names, by its number or name or its whole address. */
function lineAt(store: Store, at: string): Line | undefined {
  return store.lines.find(line => line.url === at || new URL(line.url).hostname.replace(/^\[|\]$/g, '') === at)
}

/**
 * Keep a line open to the server whose link this is. This computer gets in there with a key of
 * its own for the line, apart from the key OpenAgent has there. A line this computer already had
 * to that server is replaced, and the key it was asked for with is taken out there.
 */
async function addLine(io: CliIO, pasted: string, mode: Line['mode']): Promise<Status> {
  const link = readLineLink(pasted)
  if (!link) throw new Refused('That is not a link a server gives: on the server, Devices, Add device.')
  const before = await readStore(io.env)
  if (!lineAt(before, link.url) && before.lines.length >= MAX_LINES) throw new Refused('This computer keeps as many lines as it can: remove one first.')
  // Which computer this is, as OpenAgent tells the commands it runs: the server lists it once, and a line asked for anew takes the old one's place.
  const computer = isComputerId(io.env.OPENAGENT_COMPUTER) ? computerWordFor(io.env.OPENAGENT_COMPUTER, link.url) : undefined
  const entered = await (io.enterForLine ?? enterForLine)(link, ownName(), computer)
  if (!entered.ok) throw new Refused(`The server did not give a line: ${entered.error}`)
  // Who this computer's person is there: a call down the line for anyone else is no call of theirs.
  const account = (await (io.askMe ?? askMe)({ url: link.url, pin: link.pin, key: entered.key }))?.account
  const line: Line = { url: link.url, pin: link.pin, key: entered.key, mode, ...(account !== undefined ? { account } : {}) }
  const old = await update(io.env, store => {
    const had = lineAt(store, link.url)
    store.lines = [...store.lines.filter(kept => kept !== had), line]
    return had
  })
  // Waited for: the command ends with its answer, and the key the old line was asked for with must not stay on the server.
  if (old) await (io.leaveLine ?? leaveLine)(old, link.door)
  return statusOf(await readStore(io.env), io.env)
}

/**
 * What the server may do through its line, and for whom: `full` for this computer's own person
 * there, `everyone` for each person there as a user of their own here, `watch` only to read.
 */
async function setLineMode(io: CliIO, at: string, mode: Line['mode'] | 'everyone'): Promise<Status> {
  // Everyone gets a user of their own here: only a computer set up as a server makes them.
  if (mode === 'everyone' && !io.env.OPENAGENT_PERSON_HELPER) throw new Refused('This computer is not set up as a server: only a server lets everyone at another start runs on it, each as a user of their own.')
  const found = await update(io.env, store => {
    const line = lineAt(store, at)
    // A line the server said no to is not one any more: it is asked for anew, with a new link.
    // Letting the server do less is written all the same: what it may do, should the old line ever carry again, is the least the person said.
    if (line && (!line.refused || mode === 'watch')) {
      line.mode = mode === 'watch' ? 'watch' : 'full'
      if (mode === 'everyone') line.for = 'everyone'
      else delete line.for
    }
    return line
  })
  if (!found) throw new Refused(`This computer keeps no line to ${at}.`)
  if (found.refused) throw new Refused(`The server at ${at} no longer lets this computer in for its line. Ask for the line anew, with a new link.`)
  return statusOf(await readStore(io.env), io.env)
}

async function removeLine(io: CliIO, at: string): Promise<Status> {
  const removed = await update(io.env, store => {
    const line = lineAt(store, at)
    store.lines = store.lines.filter(kept => kept !== line)
    return line
  })
  if (!removed) throw new Refused(`This computer keeps no line to ${at}.`)
  // A server that cannot be reached right now keeps the key until this computer is removed there, among its devices.
  if (!(await (io.leaveLine ?? leaveLine)(removed, `${removed.url}${ENTER_PATH}`))) io.stderr(`The server could not be told: it still lists this computer among its devices. Remove it there.`)
  return statusOf(await readStore(io.env), io.env)
}

async function runServe(io: CliIO): Promise<void> {
  const target = io.env.OPENAGENT_URL
  if (!target) throw new Refused('serve is run by OpenAgent: OPENAGENT_URL says where OpenAgent is, and it is not set')
  const portIn = (name: string): number | undefined => {
    const port = io.env[name] ? Number(io.env[name]) : undefined
    if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port < 65536)) throw new Refused(`${name} is not a port`)
    return port
  }
  const port = portIn('OPENAGENT_REMOTE_ACCESS_PORT')
  // For a try on a computer that is no real server: another port for the proof, another certificate office.
  const proofPort = portIn('OPENAGENT_REMOTE_ACCESS_PROOF_PORT')
  const directory = io.env.OPENAGENT_REMOTE_ACCESS_ACME || undefined
  const controller = new AbortController()
  const stop = (): void => controller.abort()
  let watch: NodeJS.Timeout | undefined
  if (io.signal) io.signal.addEventListener('abort', stop, { once: true })
  else {
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    // The door goes with the OpenAgent that started it, also when that one died without a word.
    const parent = process.ppid
    watch = setInterval(() => {
      if (process.ppid !== parent) stop()
    }, 2_000)
  }
  try {
    if (io.signal?.aborted) stop()
    await serve({ env: io.env, target, signal: controller.signal, log: io.stderr, ...(port !== undefined ? { port } : {}), ...(proofPort !== undefined ? { proofPort } : {}), ...(directory ? { directory } : {}), ...(io.host !== undefined ? { host: io.host } : {}), ...(io.address ? { address: io.address } : {}) })
  } finally {
    // Whatever ended it, nothing of it is left to keep the process alive.
    clearInterval(watch)
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
        return print(statusOf(await readStore(io.env), io.env))
      case 'on':
      case 'off':
        if (rest.length) break
        return print(await setSwitch(io, command === 'on'))
      case 'add': {
        const [flag, account] = rest
        if (rest.length === 0) return print(await addDevice(io))
        if (rest.length !== 2 || flag !== '--for' || !account) break
        return print(await addDevice(io, account))
      }
      case 'github': {
        if (rest.length) break
        // Nobody's is an answer too, with why: a page asks this to know whom to name.
        const own = await (io.github ?? ghAccount)()
        return print(own.ok ? { account: own.account } : { problem: own.error })
      }
      case 'owner': {
        const [said] = rest
        if (rest.length !== 1 || !said) break
        const account = accountOf(said)
        if (account === undefined) throw new Refused(`${said} is not a GitHub account`)
        if (!(await nameOwner(io.env, account))) throw new Refused(`This computer's owner is @${(await readStore(io.env)).persons[0]?.account}.`)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'remove-person': {
        const [said] = rest
        if (rest.length !== 1 || !said) break
        const account = accountOf(said)
        const refused = `${said} is no person here that can be removed: the owner stays.`
        const person = account === undefined ? undefined : (await readStore(io.env)).persons.find(candidate => candidate.account === account && !candidate.owner)
        if (account === undefined || !person) throw new Refused(refused)
        // Their user first, with all it holds: a person whose user could not be removed stays listed, to be removed again.
        // A making still at work is ended first, so it does not make the user again once it is gone.
        stopWork(person.worker)
        const helper = helperOf(io)
        if (helper && person.port !== undefined) {
          const gone = await helper(['remove', account])
          if (!gone.ok) throw new Refused(`@${account}'s user on this computer could not be removed: ${gone.error}`)
        }
        if (!(await removePerson(io.env, account))) throw new Refused(refused)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'keep': {
        const [said] = rest
        if (rest.length !== 1 || !said) break
        const account = accountOf(said)
        const kept = account !== undefined && (await update(io.env, store => {
          const person = store.persons.find(candidate => candidate.account === account && !candidate.owner)
          if (person) person.kept = true
          return person !== undefined
        }))
        if (!kept) throw new Refused(`${said} is no person here that can be kept.`)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'remove': {
        const [id] = rest
        if (rest.length !== 1 || !id) break
        if (!(await removeComputer(io.env, id))) throw new Refused(`no device has the id ${id}`)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'https': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const at = address === 'off' ? undefined : addressOf(address)
        if (address !== 'off' && at === undefined) throw new Refused(`${address} is not a server's number or name`)
        return print(await setHttps(io, at))
      }
      case 'line': {
        const [what, at, how] = rest
        // A link holds a code that works once: a program hands it over on standard input, where no other program sees it.
        if (what === 'add' && at && (rest.length === 2 || (rest.length === 3 && how === 'watch'))) return print(await addLine(io, at === '-' ? await (io.stdin ?? ownStdin)() : at, how === 'watch' ? 'watch' : 'full'))
        if ((what === 'full' || what === 'watch' || what === 'everyone') && at && rest.length === 2) return print(await setLineMode(io, at, what))
        if (what === 'remove' && at && rest.length === 2) return print(await removeLine(io, at))
        break
      }
      case 'serve':
        if (rest.length) break
        await runServe(io)
        return 0
      // Not for a person: the process `add --for` starts to make a person's user.
      case 'person-work': {
        const [said] = rest
        const account = said === undefined ? undefined : accountOf(said)
        if (rest.length !== 1 || account === undefined) break
        await personWork(io, account)
        return print({ ok: true })
      }
      default:
    }
  } catch (err) {
    if (!(err instanceof Refused || err instanceof Unreadable)) throw err
    io.stderr(err.message)
    return 1
  }
  io.stderr(USAGE)
  return 2
}

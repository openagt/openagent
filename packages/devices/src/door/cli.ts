import { nameAddress, numberAddress, ownAddresses, urlHost, type AddressDeps } from './address.js'
import { doorFingerprint } from './certificate.js'
import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { ENTER_PATH, readKeyWord } from './door.js'
import { askMe, enterForLine, leaveLine, readLineLink } from './line-out.js'
import { askAt, cancelAt, doorOrigin, hearAt, mayAnswerAsks, waitingAsks } from './pair.js'
import { startPersonWork } from './persons.js'
import { HTTPS_PORT, serve } from './serve.js'
import { announce, find } from './wifi.js'
import { tailscaleName, tailscaleRun, type TailscaleRun } from './tailscale.js'
import { renderUnicodeCompact } from 'uqr'
import { MAX_LINES, Unreadable, answerAsk, readStoreStrict, nameFromWord, nameOf, nameWord, addCode, shownCode, addPerson, addressOf, computerWordFor, isComputerId, listedDevices, nameOwner, pidAlive, readStore, removeComputer, removePerson, renameComputer, samePerson, update, type Line, type ListedDevice, type Store } from './store.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went: 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the other packages' commands, so a person and a dashboard read it the same way.
 */

export const USAGE = `usage: devices <command>

  status         whether On this Wi-Fi is on, whether the door listens, and the devices that are in
  on             On this Wi-Fi on: the door opens on the network this computer is on, over plain HTTP
  off            On this Wi-Fi off: nothing listens on the network; the devices stay in the list
  add [--for <name>] [--qr]
                 a code a new device gets in with, once, for ten minutes, and the link a QR code holds; with --for,
                 the device is that person's, by their name (the owner is named first); where
                 OPENAGENT_PERSON_HELPER names the helper, the person gets a user and an OpenAgent of their own;
                 with --qr, the QR code is drawn on standard error too, for a computer with no screen of its own
  remove <id>    take one device out, by its id as status names it; it is out at once, a computer with all it holds here
  rename <id> <name>
                 call a device by another name, by its id as status names it; a computer under all it holds here
  me             the name of the person at this computer, as git knows it: who the owner would be
  owner <name>
                 name this computer's owner, once: the devices already in are theirs
  remove-person <name>
                 take a person out, with every device of theirs, and their user with all it holds; the owner stays
  keep <name>    keep a person a server's line made here, though that server no longer has them: nobody is asked about them again
  https <at>     this computer is a server, reached at this number or name: the door is open to every network,
                 over HTTPS, with a certificate it asks for and renews itself (ports 80 and 443 must be reachable)
  https off      no longer a server: On this Wi-Fi decides again
  tailscale on   the door is open to your own devices on your Tailscale network, over HTTPS, at this computer's
                 name there; Tailscale must run here, signed in, and Serve be on for your Tailscale network
  tailscale off  no longer on Tailscale: On this Wi-Fi decides again
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
  find           the computers on this Wi-Fi whose door is open there: their name, OpenAgent's version, where their door is
  ask <url>      ask the computer whose door is at <url>, as find names it, to let this one in: the number both screens
                 show, and the secret the answer is heard by
  ask-answer <url> -
                 whether a person there allowed it, with the secret on standard input: waits a while for the answer, and
                 once allowed, answers the link this computer gets in with
  ask-cancel <url> -
                 take this computer's ask away there, with the secret on standard input
  asks [--wait <seconds>] [--seen <id,…>]
                 the computers on this Wi-Fi asking to get in here; with --wait, waits up to that long (at most 25) until
                 they are other than --seen says
  allow <id>     let in the computer asking by that id; deny <id> says no, and it waits a minute to ask again
  serve          the door's own process, run by OpenAgent for as long as it runs itself (OPENAGENT_URL says where OpenAgent is)
  server <command>
                 the servers this computer sets up over SSH: devices server lists their commands`

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
  /** How this Wi-Fi is asked for the doors open on it, and how `serve` says its door there; on the network itself when unsaid. */
  find?: typeof find
  announce?: typeof announce
  /** How often `asks --wait` looks at the file. */
  asksLookMs?: number
  /** The name of the person at this computer, as git knows it; asked of git when unsaid. */
  myName?: () => Promise<string | undefined>
  /** How the helper at `path` is run as root with `args`; with `sudo -n` when unsaid. */
  helper?: (path: string, args: string[]) => Promise<HelperAnswer>
  /** How the making of a person's user is started on its own, answering its process; this command again, detached, when unsaid. */
  startWork?: (env: NodeJS.ProcessEnv, person: string) => number | undefined
  /** How the `tailscale` command is run; the computer's own when unsaid. */
  tailscale?: TailscaleRun
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
  /** Behind Tailscale: this computer's name on the person's Tailscale network, which the door is open at. */
  tailscale?: { address: string }
  /** Where the person fixes the problem themselves, in an account of theirs: Tailscale's page that turns Serve on. */
  fixAt?: string
  /**
   * Set on the OpenAgent of one person on a computer several people use, to their name:
   * that person's devices are in the owner's door, and this one's own file is not theirs.
   */
  person?: string
  /**
   * The devices that are in, a computer once: its key for OpenAgent and its line are one row,
   * under the first one's id, with the other's in `also`. A device with `line` is a computer that
   * keeps a line open here.
   */
  devices: ListedDevice[]
  /** The persons on this computer, by their name, the owner first; none until the owner is named. */
  persons: {
    name: string
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
  lines: { url: string; mode: Line['mode']; for?: 'everyone'; person?: string; id?: string; refused?: true }[]
}

/** Whether the door should be open: the switch is on, or the computer is a server, or it is reached over Tailscale. */
const wanted = (store: Store): boolean => store.on || store.https !== undefined || store.tailscale !== undefined

const isListening = (store: Store): boolean => wanted(store) && store.listening !== undefined && pidAlive(store.listening.pid)

/** Why a door that should be open does not listen, when its own process said nothing: that process is not running. */
const NOT_RUNNING = 'The door opens once OpenAgent runs on this computer.'

/**
 * Whose OpenAgent this is, when it is one person's on a computer several people use: the person's
 * own, started for them beside the owner's. Their devices are in the owner's door, not here.
 */
function ownPerson(env: NodeJS.ProcessEnv): string | undefined {
  return env.OPENAGENT_PERSON ? nameFromWord(env.OPENAGENT_PERSON) : undefined
}

/**
 * Whether a person a server's line made here is no longer that server's: this computer keeps no
 * line to it, the server no longer lets the line in, or its door no longer lists them among its
 * persons. A line that is for only this computer's person again says nothing of them: they are
 * switched off here, not gone there.
 */
function goneFrom(store: Store, person: string, from: string): boolean {
  const line = store.lines.find(candidate => candidate.url === from)
  return !line || line.refused === true || (line.for === 'everyone' && line.persons !== undefined && !line.persons.includes(person))
}

function statusOf(store: Store, env: NodeJS.ProcessEnv): Status {
  const listening = isListening(store)
  const problem = !wanted(store) ? undefined : listening ? (store.https ? store.problem : undefined) : (store.problem ?? NOT_RUNNING)
  const person = ownPerson(env)
  return {
    on: store.on,
    listening,
    ...(problem ? { problem } : {}),
    ...(store.https ? { https: { address: store.https.address } } : {}),
    ...(store.tailscale ? { tailscale: { address: store.tailscale.address } } : {}),
    ...(problem !== undefined && store.fixAt !== undefined ? { fixAt: store.fixAt } : {}),
    ...(person !== undefined ? { person } : {}),
    devices: listedDevices(store),
    persons: store.persons.map(({ name, owner, port, ready, problem, worker, from, kept }) => ({
      name,
      ...(owner ? { owner } : {}),
      // Only where the person gets a user of their own: how its making goes.
      ...(port !== undefined && ready ? { ready } : {}),
      ...(port !== undefined && worker !== undefined && pidAlive(worker) ? { working: true as const } : {}),
      ...(port !== undefined && problem !== undefined ? { problem } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(from !== undefined && goneFrom(store, name, from) ? { removed: true as const } : {}),
      ...(kept ? { kept } : {}),
    })),
    lines: store.lines.map(({ url, mode, for: who, person, key, refused }) => {
      const id = readKeyWord(key)?.id
      return { url, mode, ...(who ? { for: who } : {}), ...(person !== undefined ? { person } : {}), ...(id ? { id } : {}), ...(refused ? { refused: true as const } : {}) }
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

/**
 * Behind Tailscale or not: this computer's name on the person's Tailscale network is asked of
 * Tailscale, and the answer waits a moment for the door's process to open the door there. A
 * server's door is open on the internet already, and stays as it is.
 */
async function setTailscale(io: CliIO, on: boolean): Promise<Status> {
  let address: string | undefined
  if (on) {
    const store = await readStore(io.env)
    if (store.https) throw new Refused('This computer is a server: its door is open on the internet already.')
    const name = await tailscaleName(io.tailscale ?? tailscaleRun(io.env))
    if (!name.ok) throw new Refused(name.problem)
    address = name.value
  }
  await update(io.env, store => {
    if (address === undefined) delete store.tailscale
    else store.tailscale = { address }
    delete store.problem
    delete store.fixAt
    // Where the door listened until now is not where it will: its process says so anew.
    delete store.listening
  })
  const deadline = Date.now() + (io.followMs ?? 3_000)
  for (;;) {
    const store = await readStore(io.env)
    const settled = address === undefined ? !isListening(store) || store.on : isListening(store) || store.problem !== undefined
    if (settled || Date.now() > deadline) return statusOf(store, io.env)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** A code as a command answers it: the link a camera opens, and what is typed instead, where and the code. */
interface Given {
  url: string
  numberUrl?: string
  where: string
  code: string
  expires: string
  person?: string
}

async function addDevice(io: CliIO, said?: string): Promise<Given> {
  const store = await readStore(io.env)
  const status = statusOf(store, io.env)
  // Asked once the door can give a link: a person's user is made on the way, which takes a while and is not undone.
  const whose = (): Promise<string | undefined> => (said === undefined ? Promise.resolve(undefined) : forPerson(io, store, said))
  if (store.tailscale) {
    if (!status.listening) throw new Refused(status.problem ?? 'the door is not open')
    const person = await whose()
    const { code, expires } = await addCode(io.env, Date.now(), person)
    // Tailscale's certificate is one every device trusts: a device that opens the link needs no key of the door's to know it by.
    return { url: `https://${store.tailscale.address}${ENTER_PATH}#${code}`, where: store.tailscale.address, code: shownCode(code), expires, ...(person !== undefined ? { person } : {}) }
  }
  if (store.https) {
    if (!status.listening) throw new Refused(status.problem ?? 'the door is not open')
    const fingerprint = await doorFingerprint(io.env)
    if (!fingerprint) throw new Refused('the door has no key yet')
    const person = await whose()
    const { code, expires } = await addCode(io.env, Date.now(), person)
    const port = store.listening!.port
    const where = `${urlHost(store.https.address)}${port === HTTPS_PORT ? '' : `:${port}`}`
    // After the code, what the door's key is known by: a device that opens the link knows the door again by it.
    return { url: `https://${where}${ENTER_PATH}#${code}.${fingerprint}`, where, code: shownCode(code), expires, ...(person !== undefined ? { person } : {}) }
  }
  if (!status.on) throw new Refused('On this Wi-Fi is off: turn it on first')
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
  return { url: link(first), ...(name && number ? { numberUrl: link(number) } : {}), where: `${urlHost(first)}:${port}`, code: shownCode(code), expires, ...(person !== undefined ? { person } : {}) }
}

/**
 * The person a code is for, by the name given: put among the persons when they are not yet.
 * `undefined` for the owner's own name: the device is the owner's, as with no `--for`.
 *
 * On a computer that gives each person a user of their own, the person gets a block of ports, and
 * the helper is started on its own to make their user, with their own OpenAgent on the first port
 * of the block. That takes a minute or two, longer than a page waits for a command, so the code is
 * answered at once and the file says how the making goes (`ready`, `problem`). Whoever gets in
 * with the code reaches that person's OpenAgent and no other, once it is up. Asked again for a
 * person whose user could not be made, the helper is started again.
 */
async function forPerson(io: CliIO, store: Store, said: string): Promise<string | undefined> {
  const name = nameOf(said)
  if (name === undefined) throw new Refused(`${said} is not a name: letters, digits, spaces, dots, apostrophes and dashes, at most 40`)
  const owner = store.persons.find(person => person.owner)
  if (!owner) throw new Refused('Name the owner first: devices owner <your name>')
  if (samePerson(owner.name, name)) return undefined
  const helper = helperOf(io)
  const person = await addPerson(io.env, name, Date.now(), helper !== undefined)
  if (!person) throw new Refused('This computer has as many persons as it can: remove one first.')
  if (helper && person.port !== undefined && !person.ready && !(person.worker !== undefined && pidAlive(person.worker))) {
    const worker = (io.startWork ?? startPersonWork)(io.env, person.name)
    await update(io.env, kept => {
      const known = kept.persons.find(candidate => candidate.name === person.name && !candidate.owner)
      if (!known) return
      delete known.problem
      if (worker !== undefined) known.worker = worker
    })
  }
  return person.name
}

/**
 * Make a person's user: the helper's work, run by the process {@link forPerson} started, which
 * writes in the file how it ended. Its words are written only while the file still names this
 * process as the person's: a person removed meanwhile, or asked for anew, is another's to say.
 */
async function personWork(io: CliIO, name: string): Promise<void> {
  const helper = helperOf(io)
  if (!helper) throw new Refused('OPENAGENT_PERSON_HELPER does not name the helper here')
  const person = (await readStore(io.env)).persons.find(candidate => candidate.name === name && !candidate.owner)
  if (person?.port === undefined) throw new Refused(`${name} is no person here with a user to make`)
  // Another process at it already: it says how it ended.
  if (person.worker !== undefined && person.worker !== process.pid && pidAlive(person.worker)) return
  const mine = await update(io.env, kept => {
    const known = kept.persons.find(candidate => candidate.name === name && candidate.port === person.port)
    if (known) known.worker = process.pid
    return known !== undefined
  })
  if (!mine) return
  const made = await helper(['add', nameWord(name), String(person.port)])
  await update(io.env, kept => {
    const known = kept.persons.find(candidate => candidate.name === name && candidate.worker === process.pid)
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

/** How long the helper may take: making a person's user installs Claude Code and Codex for them. */
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

/** The name of the person at this computer, as git knows it: the one their commits carry. */
function gitName(): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile('git', ['config', '--global', '--get', 'user.name'], { timeout: 15_000 }, (err, out) => resolve(err ? undefined : nameOf(String(out))))
  })
}

/** All of the process's standard input, as text. */
async function ownStdin(): Promise<string> {
  let said = ''
  for await (const chunk of process.stdin.setEncoding('utf8')) said += chunk
  return said
}

/** This computer's name as a server lists it, and another computer on the Wi-Fi it asks. */
function ownName(deps: AddressDeps = {}): string {
  return (deps.hostname ?? hostname)().replace(/\.local$/i, '') || 'A computer'
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
  const person = (await (io.askMe ?? askMe)({ url: link.url, pin: link.pin, key: entered.key }))?.person
  const line: Line = { url: link.url, pin: link.pin, key: entered.key, mode, ...(person !== undefined ? { person } : {}) }
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
    await serve({ env: io.env, target, signal: controller.signal, log: io.stderr, ...(port !== undefined ? { port } : {}), ...(proofPort !== undefined ? { proofPort } : {}), ...(directory ? { directory } : {}), ...(io.host !== undefined ? { host: io.host } : {}), ...(io.address ? { address: io.address } : {}), ...(io.announce ? { announce: io.announce } : {}), ...(io.tailscale ? { tailscale: io.tailscale } : {}) })
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
  const usage = (): number => {
    io.stderr(USAGE)
    return 2
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
        // With --qr, the code the link holds is drawn too: a computer with no screen of its own is paired from a terminal.
        const qr = rest.at(-1) === '--qr'
        const said = qr ? rest.slice(0, -1) : rest
        const [flag, person] = said
        if (said.length !== 0 && (said.length !== 2 || flag !== '--for' || !person)) break
        const given = await addDevice(io, said.length === 2 ? person : undefined)
        if (qr) io.stderr(`${renderUnicodeCompact(given.url)}\nScan it with the device's camera, or open ${given.url} on it, within ten minutes.`)
        return print(given)
      }
      case 'me': {
        if (rest.length) break
        // No name is an answer too: the page then asks the person for theirs.
        const name = await (io.myName ?? gitName)()
        return print(name !== undefined ? { name } : {})
      }
      case 'owner': {
        const [said] = rest
        if (rest.length !== 1 || !said) break
        const name = nameOf(said)
        if (name === undefined) throw new Refused(`${said} is not a name: letters, digits, spaces, dots, apostrophes and dashes, at most 40`)
        if (!(await nameOwner(io.env, name))) throw new Refused(`This computer's owner is ${(await readStore(io.env)).persons[0]?.name}.`)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'remove-person': {
        const [said] = rest
        if (rest.length !== 1 || !said) break
        const refused = `${said} is no person here that can be removed: the owner stays.`
        const person = (await readStore(io.env)).persons.find(candidate => candidate.name === said && !candidate.owner)
        if (!person) throw new Refused(refused)
        // Their user first, with all it holds: a person whose user could not be removed stays listed, to be removed again.
        // A making still at work is ended first, so it does not make the user again once it is gone.
        stopWork(person.worker)
        const helper = helperOf(io)
        if (helper && person.port !== undefined) {
          const gone = await helper(['remove', nameWord(person.name)])
          if (!gone.ok) throw new Refused(`${person.name}'s user on this computer could not be removed: ${gone.error}`)
        }
        if (!(await removePerson(io.env, person.name))) throw new Refused(refused)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'keep': {
        const [said] = rest
        if (rest.length !== 1 || !said) break
        const kept = await update(io.env, store => {
          const person = store.persons.find(candidate => candidate.name === said && !candidate.owner)
          if (person) person.kept = true
          return person !== undefined
        })
        if (!kept) throw new Refused(`${said} is no person here that can be kept.`)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'remove': {
        const [id] = rest
        if (rest.length !== 1 || !id) break
        if (!(await removeComputer(io.env, id))) throw new Refused(`no device has the id ${id}`)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'rename': {
        const [id, name] = rest
        if (rest.length !== 2 || !id || !name) break
        if (!name.trim()) throw new Refused('give it a name')
        if (!(await renameComputer(io.env, id, name))) throw new Refused(`no device has the id ${id}`)
        return print(statusOf(await readStore(io.env), io.env))
      }
      case 'https': {
        const [address] = rest
        if (rest.length !== 1 || !address) break
        const at = address === 'off' ? undefined : addressOf(address)
        if (address !== 'off' && at === undefined) throw new Refused(`${address} is not a server's number or name`)
        return print(await setHttps(io, at))
      }
      case 'tailscale': {
        const [how] = rest
        if (rest.length !== 1 || (how !== 'on' && how !== 'off')) break
        return print(await setTailscale(io, how === 'on'))
      }
      case 'line': {
        const [what, at, how] = rest
        // A link holds a code that works once: a program hands it over on standard input, where no other program sees it.
        if (what === 'add' && at && (rest.length === 2 || (rest.length === 3 && how === 'watch'))) return print(await addLine(io, at === '-' ? await (io.stdin ?? ownStdin)() : at, how === 'watch' ? 'watch' : 'full'))
        if ((what === 'full' || what === 'watch' || what === 'everyone') && at && rest.length === 2) return print(await setLineMode(io, at, what))
        if (what === 'remove' && at && rest.length === 2) return print(await removeLine(io, at))
        break
      }
      case 'find': {
        if (rest.length) break
        const store = await readStore(io.env)
        // Not this computer's own door, which it announces too.
        const own = ownAddresses(io.address)
        const port = isListening(store) && !store.https ? store.listening!.port : undefined
        const found = await (io.find ?? find)().catch((err: unknown) => {
          throw new Refused(`This Wi-Fi could not be looked at: ${err instanceof Error ? err.message : String(err)}`)
        })
        return print({ found: found.filter(door => !(own.has(new URL(door.url).hostname) && Number(new URL(door.url).port) === port)) })
      }
      case 'ask': {
        const [at] = rest
        const origin = at === undefined ? undefined : doorOrigin(at)
        if (rest.length !== 1 || origin === undefined) break
        const asked = await askAt(origin, ownName(io.address))
        if (!asked.ok) throw new Refused(asked.error)
        return print(asked.value)
      }
      case 'ask-answer':
      case 'ask-cancel': {
        const [at, dash] = rest
        const origin = at === undefined ? undefined : doorOrigin(at)
        if (rest.length !== 2 || origin === undefined || dash !== '-') break
        // The secret comes on standard input, where no other program on this computer sees it.
        const secret = (await (io.stdin ?? ownStdin)()).trim()
        if (!secret) throw new Refused('no secret on standard input')
        if (command === 'ask-cancel') return print({ ok: await cancelAt(origin, secret) })
        const heard = await hearAt(origin, secret)
        if (!heard.ok) throw new Refused(heard.error)
        return print(heard.value)
      }
      case 'asks': {
        let wait = 0
        let seen: string | undefined
        for (let i = 0; i < rest.length; i += 2) {
          const [flag, value] = [rest[i], rest[i + 1]]
          if (flag === '--wait' && value !== undefined && /^\d+$/.test(value)) wait = Math.min(Number(value), 25)
          else if (flag === '--seen' && value !== undefined) seen = value
          else return usage()
        }
        // Another person's device sees none: only this computer's own screen and the owner's devices are asked.
        if (!mayAnswerAsks(io.env)) return print({ asks: [] })
        const until = Date.now() + wait * 1000
        for (;;) {
          const store = await readStoreStrict(io.env)
          const asks = store === 'unreadable' ? [] : waitingAsks(store)
          // Answered at once with nothing seen yet, or once the asks are other than the page has.
          if (seen === undefined || asks.map(ask => ask.id).join(',') !== seen || Date.now() >= until) return print({ asks })
          await new Promise(resolve => setTimeout(resolve, io.asksLookMs ?? 500))
        }
      }
      case 'allow':
      case 'deny': {
        const [id] = rest
        if (rest.length !== 1 || !id) break
        if (!mayAnswerAsks(io.env)) throw new Refused("Only this computer's owner lets a computer in.")
        if (!(await answerAsk(io.env, id, command === 'allow' ? 'allowed' : 'denied'))) throw new Refused('That computer is no longer asking.')
        return print({ asks: waitingAsks(await readStore(io.env)) })
      }
      case 'serve':
        if (rest.length) break
        await runServe(io)
        return 0
      // Not for a person: the process `add --for` starts to make a person's user.
      case 'person-work': {
        const [said] = rest
        const name = said === undefined ? undefined : nameOf(said)
        if (rest.length !== 1 || name === undefined) break
        await personWork(io, name)
        return print({ ok: true })
      }
      default:
    }
  } catch (err) {
    if (!(err instanceof Refused || err instanceof Unreadable)) throw err
    io.stderr(err.message)
    return 1
  }
  return usage()
}

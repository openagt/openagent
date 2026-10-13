import { nameAddress, numberAddress, urlHost, type AddressDeps } from './address.js'
import { doorFingerprint } from './certificate.js'
import { hostname } from 'node:os'
import { ENTER_PATH } from './door.js'
import { enterForLine, leaveLine, readLineLink } from './line-out.js'
import { HTTPS_PORT, serve } from './serve.js'
import { MAX_LINES, Unreadable, addCode, addressOf, pidAlive, readStore, removeDevice, update, type Line, type Store } from './store.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went: 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the other packages' commands, so a person and a dashboard read it the same way.
 */

export const USAGE = `usage: remote-access <command>

  status         whether Phone on Wi-Fi is on, whether the door listens, and the devices that are in
  on             Phone on Wi-Fi on: the door opens on the network this computer is on, over plain HTTP
  off            Phone on Wi-Fi off: nothing listens on the network; the devices stay in the list
  add            a link a new device gets in with, once, for five minutes: the address a QR code holds
  remove <id>    take one device out, by its id as status names it; it is out at once
  https <at>     this computer is a server, reached at this number or name: the door is open to every network,
                 over HTTPS, with a certificate it asks for and renews itself (ports 80 and 443 must be reachable)
  https off      no longer a server: Phone on Wi-Fi decides again
  line add <link> [watch]
                 keep a line open to a server, so a run can be started on this computer from the server's page;
                 the link is the one the server gives for a new device, or - to read it from standard input;
                 with watch the server only reads
  line full <at> the server at this number or name may do through its line everything a machine is asked
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
  /** A device with `line` is a computer that keeps a line open here. */
  devices: { id: string; name: string; added: string; seen?: string; line?: true }[]
  /** The servers this computer keeps a line open to, and what each may do through it. */
  lines: { url: string; mode: Line['mode'] }[]
}

const isListening = (store: Store): boolean => (store.on || store.https !== undefined) && store.listening !== undefined && pidAlive(store.listening.pid)

/** Why a door that should be open does not listen, when its own process said nothing: that process is not running. */
const NOT_RUNNING = 'The door opens once OpenAgent runs on this computer.'

function statusOf(store: Store): Status {
  const listening = isListening(store)
  const wanted = store.on || store.https !== undefined
  const problem = !wanted ? undefined : listening ? (store.https ? store.problem : undefined) : (store.problem ?? NOT_RUNNING)
  return {
    on: store.on,
    listening,
    ...(problem ? { problem } : {}),
    ...(store.https ? { https: { address: store.https.address } } : {}),
    devices: store.devices.map(({ id, name, added, seen, line }) => ({ id, name, added, ...(seen ? { seen } : {}), ...(line ? { line: true as const } : {}) })),
    lines: store.lines.map(({ url, mode }) => ({ url, mode })),
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
    if (settled || Date.now() > deadline) return statusOf(store)
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
    if (settled || Date.now() > deadline) return statusOf(store)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function addDevice(io: CliIO): Promise<{ url: string; numberUrl?: string; expires: string }> {
  const store = await readStore(io.env)
  const status = statusOf(store)
  if (store.https) {
    if (!status.listening) throw new Refused(status.problem ?? 'the door is not open')
    const fingerprint = await doorFingerprint(io.env)
    if (!fingerprint) throw new Refused('the door has no key yet')
    const { code, expires } = await addCode(io.env)
    const port = store.listening!.port
    // After the code, what the door's key is known by: a computer that pastes the link knows the door again by it.
    return { url: `https://${urlHost(store.https.address)}${port === HTTPS_PORT ? '' : `:${port}`}${ENTER_PATH}#${code}.${fingerprint}`, expires }
  }
  if (!status.on) throw new Refused('Phone on Wi-Fi is off: turn it on first')
  if (!status.listening) throw new Refused(status.problem ?? 'the door is not open')
  const port = store.listening!.port
  const name = await nameAddress(io.address)
  const number = numberAddress(io.address)
  const first = name ?? number
  if (!first) throw new Refused('this computer is on no network a device could reach it on')
  const { code, expires } = await addCode(io.env)
  const link = (host: string): string => `http://${urlHost(host)}:${port}${ENTER_PATH}#${code}`
  // The number beside the name, for the phone that cannot open a name on the network.
  return { url: link(first), ...(name && number ? { numberUrl: link(number) } : {}), expires }
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
  const entered = await (io.enterForLine ?? enterForLine)(link, ownName())
  if (!entered.ok) throw new Refused(`The server did not give a line: ${entered.error}`)
  const line: Line = { url: link.url, pin: link.pin, key: entered.key, mode }
  const old = await update(io.env, store => {
    const had = lineAt(store, link.url)
    store.lines = [...store.lines.filter(kept => kept !== had), line]
    return had
  })
  // Waited for: the command ends with its answer, and the key the old line was asked for with must not stay on the server.
  if (old) await (io.leaveLine ?? leaveLine)(old, link.door)
  return statusOf(await readStore(io.env))
}

async function setLineMode(io: CliIO, at: string, mode: Line['mode']): Promise<Status> {
  const found = await update(io.env, store => {
    const line = lineAt(store, at)
    if (line) line.mode = mode
    return line !== undefined
  })
  if (!found) throw new Refused(`This computer keeps no line to ${at}.`)
  return statusOf(await readStore(io.env))
}

async function removeLine(io: CliIO, at: string): Promise<Status> {
  const removed = await update(io.env, store => {
    const line = lineAt(store, at)
    store.lines = store.lines.filter(kept => kept !== line)
    return line
  })
  if (!removed) throw new Refused(`This computer keeps no line to ${at}.`)
  // A server that cannot be reached right now keeps the key until this computer is removed there, among its devices.
  await (io.leaveLine ?? leaveLine)(removed, `${removed.url}${ENTER_PATH}`)
  return statusOf(await readStore(io.env))
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
        return print(statusOf(await readStore(io.env)))
      case 'on':
      case 'off':
        if (rest.length) break
        return print(await setSwitch(io, command === 'on'))
      case 'add':
        if (rest.length) break
        return print(await addDevice(io))
      case 'remove': {
        const [id] = rest
        if (rest.length !== 1 || !id) break
        if (!(await removeDevice(io.env, id))) throw new Refused(`no device has the id ${id}`)
        return print(statusOf(await readStore(io.env)))
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
        if ((what === 'full' || what === 'watch') && at && rest.length === 2) return print(await setLineMode(io, at, what))
        if (what === 'remove' && at && rest.length === 2) return print(await removeLine(io, at))
        break
      }
      case 'serve':
        if (rest.length) break
        await runServe(io)
        return 0
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

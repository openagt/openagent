import { nameAddress, numberAddress, urlHost, type AddressDeps } from './address.js'
import { ENTER_PATH } from './door.js'
import { serve } from './serve.js'
import { Unreadable, addCode, pidAlive, readStore, removeDevice, update, type Store } from './store.js'

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
}

class Refused extends Error {}

/** What `status` answers. */
export interface Status {
  on: boolean
  /** The door's process holds the door open right now. */
  listening: boolean
  /** Why it does not, when the switch is on, in words. */
  problem?: string
  devices: { id: string; name: string; added: string; seen?: string }[]
}

const isListening = (store: Store): boolean => store.on && store.listening !== undefined && pidAlive(store.listening.pid)

/** Why a door that is switched on does not listen, when its own process said nothing: that process is not running. */
const NOT_RUNNING = 'The door opens once OpenAgent runs on this computer. An OpenAgent started with --host does not open it.'

function statusOf(store: Store): Status {
  const listening = isListening(store)
  const problem = !store.on || listening ? undefined : (store.problem ?? NOT_RUNNING)
  return {
    on: store.on,
    listening,
    ...(problem ? { problem } : {}),
    devices: store.devices.map(({ id, name, added, seen }) => ({ id, name, added, ...(seen ? { seen } : {}) })),
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

async function addDevice(io: CliIO): Promise<{ url: string; numberUrl?: string; expires: string }> {
  const store = await readStore(io.env)
  const status = statusOf(store)
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

async function runServe(io: CliIO): Promise<void> {
  const target = io.env.OPENAGENT_URL
  if (!target) throw new Refused('serve is run by OpenAgent: OPENAGENT_URL says where OpenAgent is, and it is not set')
  const port = io.env.OPENAGENT_REMOTE_ACCESS_PORT ? Number(io.env.OPENAGENT_REMOTE_ACCESS_PORT) : undefined
  if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port < 65536)) throw new Refused('OPENAGENT_REMOTE_ACCESS_PORT is not a port')
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
    await serve({ env: io.env, target, signal: controller.signal, log: io.stderr, ...(port !== undefined ? { port } : {}), ...(io.host !== undefined ? { host: io.host } : {}), ...(io.address ? { address: io.address } : {}) })
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

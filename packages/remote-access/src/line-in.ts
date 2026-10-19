import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { PassThrough, Readable, type Duplex } from 'node:stream'
import { DATA, END, HEAD, Link, RESET, carriedHeaders, carriedPath, carriedValue, readHead, sendBody, type Frame } from './frames.js'
import { PERSON_HEADER, personLinePorts, personOf, type Store } from './store.js'

/**
 * The server's end of the lines. A computer that keeps a line open here is asked through it, and
 * OpenAgent on this server asks it as it asks any saved machine: at an address. So each such
 * computer has an address of its own on this server, one only this server reaches
 * (`http://127.0.0.1:<its port>`), and what is asked there goes down the computer's line to its
 * own OpenAgent. OpenAgent learns nothing new: the computer is one more saved machine.
 *
 * Only what a machine is asked (`/_relay/…`) is carried. The address also answers where a
 * machine is added and removed, so OpenAgent saves it and drops it the way it does any other.
 *
 * The address asks for no key: whatever runs on this server as the person can ask the computer
 * through it, as it can ask this server's own OpenAgent. A server is trusted with the computers
 * that keep a line to it, which is what the person turns off on the computer, not here.
 *
 * On a server that gives each person a user of their own, a person's computer has its address in
 * that person's block of ports, and that person's own OpenAgent is told of it, not the owner's.
 * Which user may call which port is the server's firewall's to say: the owner's ports answer the
 * owner's user, a person's ports that person's.
 *
 * A computer whose line is for everyone here has an address in each person's block too, and each
 * person's OpenAgent is told of its own. So the firewall says as before who calls which, and each
 * call down the line says whom it is for (`PERSON_HEADER`): the person whose address it came to,
 * as this server says, never as the caller does. The computer sends it on to that person's own
 * OpenAgent there.
 *
 * The door passes another computer's OpenAgent down a line too ({@link Lines.pass}), so a laptop
 * reaches a computer at home through the server both are in at.
 */

/** Where OpenAgent is let in at a machine, and takes itself out: answered here for a computer on a line. */
const ENTER_PATH = '/_remote-access/enter'
/** How long a line may say nothing before it is dropped: the computer asks every fifteen seconds. */
export const LINE_QUIET_MS = 45_000
/** The headers of a call that go down the line: what its body is, and what answer is wanted. Never a key or a cookie. */
const CARRIED_HEADERS: readonly string[] = ['content-type', 'accept']

const NOT_CONNECTED = 'This computer is not connected. It must be on, with OpenAgent running.'

/** One call's answer as it arrives over the line. */
interface Pending {
  answered: boolean
  resolve: (answer: { status: number; headers: Record<string, string | string[]>; body: Readable }) => void
  reject: (err: Error) => void
  body: PassThrough
}

/** One computer's line, while it is open. */
class Session {
  private readonly link: Link
  private readonly calls = new Map<number, Pending>()
  private next = 1

  constructor(
    socket: Duplex,
    head: Buffer,
    private readonly quietMs: number,
    onGone: () => void,
  ) {
    this.link = new Link(socket, {
      quietMs,
      onFrame: frame => this.arrived(frame),
      onClose: () => {
        for (const call of this.calls.values()) this.fail(call, new Error(NOT_CONNECTED))
        this.calls.clear()
        onGone()
      },
    })
    if (head.length) this.link.take(head)
  }

  private fail(call: Pending, err: Error): void {
    if (call.answered) call.body.destroy(err)
    else call.reject(err)
  }

  private arrived({ kind, call: number, payload }: Frame): void {
    const call = this.calls.get(number)
    if (!call) return
    if (kind === HEAD && !call.answered) {
      const head = readHead(payload)
      const status = head?.status
      if (!head || typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599) return void this.giveUp(number, new Error('the computer answered something no line carries'))
      call.answered = true
      call.resolve({ status, headers: carriedHeaders(head.headers), body: call.body })
    } else if (kind === DATA && call.answered) {
      // Nothing is written to an answer that was cut, so nothing waits for it either.
      if (call.body.destroyed) return
      if (call.body.write(payload)) return
      // A reader that cannot keep up holds the line until it can, but not for long: the one call
      // is given up before the whole line would be taken for dead.
      this.link.hold(
        new Promise<void>(resolve => {
          const done = (): void => {
            clearTimeout(slow)
            resolve()
          }
          const slow = setTimeout(() => {
            this.giveUp(number, new Error('its reader did not keep up'))
            resolve()
          }, Math.floor(this.quietMs / 3))
          call.body.once('drain', done).once('close', done)
        }),
      )
    } else if (kind === END && call.answered) {
      this.calls.delete(number)
      call.body.end()
    } else {
      this.calls.delete(number)
      this.fail(call, new Error('the computer gave the call up'))
    }
  }

  /** End a call from this side: the computer is told, and nothing more is read under its number. */
  private giveUp(number: number, err: Error): void {
    const call = this.calls.get(number)
    if (!call) return
    this.calls.delete(number)
    this.link.send(RESET, number)
    this.fail(call, err)
  }

  /** Ask the computer one thing. The answer's body ends when the computer ends it, or with the line. */
  ask(method: string, path: string, headers: Record<string, string>, body: Readable, signal: AbortSignal): Promise<{ status: number; headers: Record<string, string | string[]>; body: Readable }> {
    return new Promise((resolve, reject) => {
      if (!this.link.open) return reject(new Error(NOT_CONNECTED))
      const number = this.next++
      // An answer the computer cuts ends its reader; with no reader yet, it ends nothing else.
      const answer = new PassThrough().on('error', () => {})
      this.calls.set(number, { answered: false, resolve, reject, body: answer })
      signal.addEventListener('abort', () => this.giveUp(number, new Error('the call was given up on')), { once: true })
      this.link.send(HEAD, number, Buffer.from(JSON.stringify({ method, path, headers })))
      sendBody(this.link, number, body).catch(() => this.giveUp(number, new Error('the call could not be sent')))
    })
  }

  close(): void {
    this.link.close()
  }
}

export interface LinesOptions {
  log?: (line: string) => void
  /** After how long a line that says nothing is dropped. */
  quietMs?: number
  /** Called when the computers that keep a line here changed, or one of their addresses could not be opened. */
  onChange?: () => void
}

/** One address of a computer that keeps a line here, as OpenAgent is told of it. */
export interface LineComputer {
  /** Its device id at the door. */
  id: string
  /** Which of its addresses this is: its id for its own person's, `<id>@<account>` for the one it has for another person. */
  key: string
  name: string
  /** The address on this server: `http://127.0.0.1:<port>`. */
  port: number
  /** Whose computer it is, when it is not the owner's. */
  person?: string
  /**
   * Whom of the persons here the address is for, by their GitHub account: the person whose own
   * OpenAgent, when they have one, is told of it, and whom each call through it is for. The
   * computer's own person at its own address; absent while this server has no persons.
   */
  viewer?: string
  /** At an address for another person: whose computer it is, by their GitHub account, the owner's too. */
  owner?: string
}

/** Which address of a computer is asked: its own person's, or the one it has for `person`. */
const addressKey = (id: string, person?: string): string => (person === undefined ? id : `${id}@${person}`)

export interface Lines {
  /** A computer's line arrived: it is asked through this one from now on, and the one it had is dropped. */
  take(id: string, socket: Duplex, head: Buffer): void
  /** Follow the file: an address for each computer that keeps a line, none for one that was taken out. */
  follow(store: Store): Promise<void>
  /** The addresses the computers have right now. */
  computers(): LineComputer[]
  /** Whether the computer with this device id keeps its line open right now. */
  connected(id: string): boolean
  /**
   * Ask the computer with this device id what `req` asks, at `path`, as its address here would:
   * its own person's, or the one it has for `person`. False when it has no such address.
   */
  pass(id: string, person: string | undefined, path: string, req: IncomingMessage, res: ServerResponse): boolean
  close(): Promise<void>
}

/** A computer's address on this server: where OpenAgent asks it. */
export function lineAddress(port: number): string {
  return `http://127.0.0.1:${port}`
}

export function openLines(opts: LinesOptions = {}): Lines {
  const log = opts.log ?? (() => {})
  const sessions = new Map<string, Session>()
  const addresses = new Map<string, { computer: LineComputer; server: Server }>()

  const refuse = (res: ServerResponse, status: number, text: string): void => void res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(text)
  const json = (res: ServerResponse, value: unknown): void => void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value))

  const answer = (computer: LineComputer, req: IncomingMessage, res: ServerResponse): void => {
    // Asked by OpenAgent on this server, and by no page a browser on it opened: a page says where it
    // comes from, or reached this address under a name of its own, and is turned away either way.
    const site = req.headers['sec-fetch-site']
    if (req.headers.host !== `127.0.0.1:${computer.port}` || req.headers.origin !== undefined || site === 'cross-site' || site === 'same-site') return refuse(res, 403, 'forbidden')
    ask(computer, req.url ?? '/', req, res)
  }

  /** What a computer is asked, at `path`, from here or from the door: down its line, or answered here for where a machine is added and removed. */
  const ask = ({ id, viewer }: LineComputer, path: string, req: IncomingMessage, res: ServerResponse): void => {
    // OpenAgent adds this address as a machine, and removes it, the way it does any other. The
    // key it is answered opens nothing: only this server reaches the address.
    if (path.split('?')[0] === ENTER_PATH) {
      req.resume()
      if (req.method === 'POST') return json(res, { ok: true, key: 'line' })
      if (req.method === 'DELETE') return json(res, { ok: true })
      return refuse(res, 405, 'method not allowed')
    }
    if (!carriedPath(path)) return refuse(res, 404, 'not found')
    // A read, or a call with a body, and no other kind: the computer takes no other, and a read's body is not carried.
    if (req.method !== 'GET' && req.method !== 'POST') return (req.resume(), refuse(res, 405, 'method not allowed'))
    if (req.method === 'GET') req.resume()
    const session = sessions.get(id)
    if (!session) return refuse(res, 503, NOT_CONNECTED)
    const headers: Record<string, string> = {}
    for (const name of CARRIED_HEADERS) {
      const value = carriedValue(req.headers[name])
      if (value !== undefined) headers[name] = value
    }
    // Whom the call is for: by the address it came to, never by what the caller says.
    if (viewer !== undefined) headers[PERSON_HEADER] = viewer
    const gone = new AbortController()
    const connection = req.socket
    // A caller that left before the answer ended is no longer answered: the computer is told.
    res.once('close', () => {
      if (!res.writableFinished) gone.abort()
      // A call whose body was not read to its end does not keep its connection: the next call on it would wait for what is never read.
      if (!req.complete) connection.destroy()
    })
    session.ask(req.method, path, headers, req.method === 'GET' ? Readable.from([]) : req, gone.signal).then(
      asked => {
        // Cut by the computer before anything of it could be written.
        if (asked.body.destroyed) return void res.destroy()
        try {
          res.writeHead(asked.status, asked.headers)
          // A live feed's first line may be a while away: the headers go now.
          res.flushHeaders()
        } catch {
          // An answer that cannot be written is the computer's fault, and ends this one call.
          asked.body.destroy()
          return void res.destroy()
        }
        asked.body.pipe(res)
        // A caller that left takes what still waited for it along: nothing of it holds the line.
        res.once('close', () => asked.body.destroy())
        // An answer the line cut midway is cut here too, so the caller asks again instead of waiting for ever.
        asked.body.once('error', () => res.destroy())
      },
      (err: Error) => {
        if (!res.headersSent) refuse(res, 503, err.message)
        else res.destroy()
      },
    )
  }

  const open = (computer: LineComputer): Promise<Server> =>
    new Promise((resolve, reject) => {
      const server = createServer((req, res) => answer(computer, req, res))
      server.once('error', reject)
      // This computer only: what is asked here is asked by OpenAgent on this server, and by nothing on a network.
      server.listen(computer.port, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve(server)
      })
    })

  const shut = async (server: Server): Promise<void> => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  return {
    take(id, socket, head) {
      sessions.get(id)?.close()
      const session = new Session(socket, head, opts.quietMs ?? LINE_QUIET_MS, () => {
        if (sessions.get(id) !== session) return
        sessions.delete(id)
        log(`remote-access: the line of ${addresses.get(id)?.computer.name ?? id} ended`)
      })
      sessions.set(id, session)
      log(`remote-access: ${addresses.get(id)?.computer.name ?? id} keeps a line open here`)
      // OpenAgent is told again: a computer taken off its machines is back on them once it calls anew.
      opts.onChange?.()
    },
    async follow(store) {
      const wanted = new Map<string, LineComputer>()
      for (const device of store.devices) {
        if (!device.line) continue
        const whose = personOf(store, device)
        const of = { id: device.id, name: device.name, ...(device.person !== undefined ? { person: device.person } : {}) }
        wanted.set(device.id, { ...of, key: device.id, port: device.line.port, ...(whose !== undefined ? { viewer: whose } : {}) })
        for (const [account, port] of Object.entries(device.line.others ?? {})) wanted.set(addressKey(device.id, account), { ...of, key: addressKey(device.id, account), port, viewer: account, ...(whose !== undefined ? { owner: whose } : {}) })
      }
      let changed = false
      for (const [key, held] of addresses) {
        const still = wanted.get(key)
        if (still?.port === held.computer.port && still.viewer === held.computer.viewer && still.owner === held.computer.owner) continue
        addresses.delete(key)
        // Its own address gone is the computer gone: an address for another person is only that person's way to it.
        if (key === held.computer.id) sessions.get(held.computer.id)?.close()
        await shut(held.server)
        changed = true
      }
      for (const computer of wanted.values()) {
        if (addresses.has(computer.key)) continue
        try {
          addresses.set(computer.key, { computer, server: await open(computer) })
          changed = true
        } catch (err) {
          log(`remote-access: ${computer.name} cannot be asked on this server: port ${computer.port} could not be opened (${(err as NodeJS.ErrnoException).code ?? String(err)})`)
        }
      }
      if (changed) opts.onChange?.()
    },
    computers() {
      return [...addresses.values()].map(held => held.computer)
    },
    connected(id) {
      return sessions.has(id)
    },
    pass(id, person, path, req, res) {
      const held = addresses.get(addressKey(id, person))
      if (!held) return false
      ask(held.computer, path, req, res)
      return true
    },
    async close() {
      for (const session of sessions.values()) session.close()
      sessions.clear()
      await Promise.all([...addresses.values()].map(held => shut(held.server)))
      addresses.clear()
    },
  }
}

/** How many computers can keep a line here: as many as the door lets in at all. */
const LINE_PORTS = 50

/** The ports the computers on a line are given, by OpenAgent's own address: a short way after it. */
export function linePorts(target: string, env: NodeJS.ProcessEnv): { from: number; count: number } {
  const said = env.OPENAGENT_REMOTE_ACCESS_LINE_PORT ? Number(env.OPENAGENT_REMOTE_ACCESS_LINE_PORT) : undefined
  const from = said !== undefined && Number.isInteger(said) && said > 0 && said + LINE_PORTS <= 65536 ? said : (Number(new URL(target).port) || 80) + 10
  return { from, count: LINE_PORTS }
}

/** One OpenAgent on this server to tell of its computers on a line: where it is, the ports its lines are in, and its computers. */
export interface ToTell {
  /** The person whose OpenAgent it is; absent for the owner's. */
  person?: string
  target: string
  ports: { from: number; count: number }
  computers: LineComputer[]
}

/**
 * Which OpenAgent on this server is told of which addresses: each person's own of those for
 * them, and the owner's of the rest, those for the owner and for every person with no OpenAgent
 * of their own. Every person with an OpenAgent of their own is in the list, with no computer too:
 * a computer taken out is then taken off their machines.
 */
export function whomToTell(store: Store, target: string, ports: { from: number; count: number }, computers: readonly LineComputer[]): ToTell[] {
  const persons = store.persons.filter(person => !person.owner && person.port !== undefined)
  const theirs = (account: string | undefined): boolean => account !== undefined && persons.some(person => person.account === account)
  return [
    { target, ports, computers: computers.filter(computer => !theirs(computer.viewer)) },
    ...persons.map(({ account, port }) => ({ person: account, target: `http://127.0.0.1:${port}`, ports: personLinePorts(port!), computers: computers.filter(computer => computer.viewer === account) })),
  ]
}

interface SavedMachine {
  id: string
  url: string
}

/**
 * Tell OpenAgent on this server which computers keep a line here, as its own page would: each
 * is added to its saved machines at its address, and an address in the lines' ports that no
 * computer has any more is taken off. Another person's computer is saved with whose it is, so
 * OpenAgent says so where a run is started. Throws when OpenAgent does not answer; the caller
 * tells again.
 */
export async function tellOpenAgent(target: string, computers: readonly LineComputer[], ports: { from: number; count: number }, timeoutMs = 10_000): Promise<void> {
  const origin = new URL(target).origin
  const call = async (fn: string, args: unknown[]): Promise<unknown> => {
    const res = await fetch(`${origin}/_rpc/${fn}`, {
      method: 'POST',
      // Asked as OpenAgent's own page asks: from its own address.
      headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`OpenAgent answered ${res.status} to ${fn}`)
    return ((await res.json()) as { ret?: unknown }).ret
  }
  const said = await call('onMachines', [])
  const saved: SavedMachine[] = Array.isArray(said) ? said.filter((machine): machine is SavedMachine => !!machine && typeof machine === 'object' && typeof (machine as SavedMachine).id === 'string' && typeof (machine as SavedMachine).url === 'string') : []
  const wanted = new Set(computers.map(computer => lineAddress(computer.port)))
  for (const machine of saved) {
    const port = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(machine.url)?.[1]
    if (port === undefined || Number(port) < ports.from || Number(port) >= ports.from + ports.count) continue
    if (!wanted.has(machine.url)) await call('sendRemoveMachine', [machine.id])
  }
  for (const computer of computers) {
    const address = lineAddress(computer.port)
    if (saved.some(machine => machine.url === address)) continue
    const added = (await call('sendAddMachine', [`${address}${ENTER_PATH}#line`, computer.name, ...(computer.owner !== undefined ? [computer.owner] : [])])) as { ok?: boolean; error?: string } | undefined
    if (!added?.ok) throw new Error(`OpenAgent did not save ${computer.name}: ${added?.error ?? 'no reason said'}`)
  }
}

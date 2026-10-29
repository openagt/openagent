import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import { createServer as createSecureServer, type Server as SecureServer } from 'node:https'
import type { AddressInfo, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { nameAddress, onOwnNetwork, plainAddress, urlHost, type AddressDeps } from './address.js'
import { doorFingerprint, type Secured } from './certificate.js'
import { deviceName } from './device-name.js'
import { LINE_FOR_HEADER, LINE_PATH, LINE_PROTOCOL } from './line-out.js'
import { enterPage, notInPage, type DoorKind } from './pages.js'
import { COMPUTER_HEADER, COMPUTER_NAME_HEADER, OWNERS_NAME_HEADER, PERSON_HEADER, addAsk, addCode, askOf, dropAsk, nameWord, shownCode, enter, isComputerId, isIn, listedDevices, nameComputer, personOf, portOf, readStore, removeComputer, removeDevice, sha256, shareLine, storePath, update, type Entry, type ListedDevice, type Store } from './store.js'

/**
 * The door: the one thing that lets anything in from the network. A request from a device that is in is
 * passed to OpenAgent on this computer as it came, and answered with what OpenAgent answered; so
 * a device that is in sees and does what this computer's own browser does. Anything else gets
 * one of the door's two pages, or a refusal.
 *
 * Another computer's OpenAgent gets in as a device does, with the same code and a key of its
 * own. It has no browser to keep a cookie in, so it says its name with the code, is answered its
 * key, and sends it with each call as `Authorization: Bearer`.
 *
 * On a server, a computer may also get in to keep a line open: one connection it holds from its
 * side, down which this server asks its OpenAgent things (line-in.ts). It says so as it gets in,
 * and only a computer that did is given a line.
 *
 * On a computer with persons, every call passed on says whose device made it (`PERSON_HEADER`):
 * the door sets it, and a request never brings its own. On a computer that gives each person a
 * user of their own, a person's call goes to their own OpenAgent, at the first port of their
 * block, and never to the owner's: the person is the door's to say, so a device reaches its own
 * person's OpenAgent and no other.
 *
 * Another computer's OpenAgent that is in also reaches the computers that keep a line here: it
 * lists them at `COMPUTERS_PATH`, and asks one at `VIA_PREFIX/<id>/…`, which goes down that
 * computer's line as this server's own OpenAgent would ask it. So a laptop starts a run on a
 * computer at home that nothing on a network reaches, through the server both are in at. A
 * person reaches the computers of their own person there, and the computers whose line is for
 * everyone here, and no one else's.
 *
 * A computer says as it asks for its line whether everyone here may start runs on it
 * (`LINE_FOR_HEADER`): it is then given an address for each person, each in that person's block.
 *
 * A device that is in also asks the door who it is here (`ME_PATH`): its person, whether that is
 * the owner, and that person's devices, one of which it may take out. A computer of a person asks
 * the door for a code its own line gets in with (`ME_LINE_PATH`): a person who is not the owner
 * invites nobody, and that code lets in a line and nothing else. It also asks for a code one more
 * device of its own person gets in with (`ME_CODE_PATH`), typed on another computer with the
 * door's address: what "Give it a code" shows.
 *
 * A code is short enough to type, so an address that tries wrong codes waits a minute after a few
 * (`TOO_MANY_TRIES`), whatever it tries then.
 *
 * On the Wi-Fi, another computer that found this one asks to get in with no code (`ASK_PATH`): its
 * ask waits for a person here to press Allow, and it hears the answer by a secret it was given.
 * Allowed, it is handed a code made that moment, and gets in with it as with any code.
 */

/** Every path of the door's own; never passed on. */
export const DOOR_PREFIX = '/_devices'
/** Where a scanned code lands, and where its page sends the code. */
export const ENTER_PATH = `${DOOR_PREFIX}/enter`
/** The computers that keep a line open here, for another computer's OpenAgent that is in. */
export const COMPUTERS_PATH = `${DOOR_PREFIX}/computers`
/** Where another computer's OpenAgent asks a computer on a line: `<VIA_PREFIX>/<its device id>/_relay/…`. */
export const VIA_PREFIX = `${DOOR_PREFIX}/via`
/** Who a device is here: its person, whether that is the owner, and that person's devices. */
export const ME_PATH = `${DOOR_PREFIX}/me`
/** Where a device takes one of its own person's devices out. */
export const ME_REMOVE_PATH = `${ME_PATH}/remove`
/** Where a computer that is in asks for a code its line gets in with, for its own person. */
export const ME_LINE_PATH = `${ME_PATH}/line`
/** Where a computer that is in asks for a code a device of its own person gets in with: a device that is in gives the code for the next one. */
export const ME_CODE_PATH = `${ME_PATH}/code`
/** Where a computer on this Wi-Fi asks to get in, hears the answer, and takes its ask away. */
export const ASK_PATH = `${DOOR_PREFIX}/ask`
/** The cookie a device that is in carries: its id, a dot, its key. */
export const DEVICE_COOKIE = 'oa_device'

/** As long as a browser keeps a cookie at most; sent again before it runs out, so a device stays in until it is removed. */
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60
const COOKIE_RESEND_MS = 24 * 60 * 60 * 1000
/** How often the times the devices were last seen are written to the file. */
const SEEN_FLUSH_MS = 60_000
/** A code, a computer's name and their wrapping, generously. */
const MAX_ENTER_BODY = 4 * 1024
/** How many wrong codes one address tries in a minute before it has to wait: a code is short enough to type, so not to guess. */
const WRONG_TRIES = 5
const WRONG_TRIES_MS = 60_000
/** What a door says to an address that tried too many wrong codes. */
export const TOO_MANY_TRIES = 'too many wrong codes: wait a minute'
/** What a door says to a computer it was denied to a moment ago, and to one more while as many asks as it shows at once wait. */
export const ASK_DENIED = 'denied a moment ago: wait a minute to ask again'
export const ASK_BUSY = 'other computers are asking right now: try again in a minute'
/** How long a look at an ask is held open for its answer: well under the time a command is given. */
const ASK_HOLD_MS = 20_000
const ASK_LOOK_MS = 500
/** The computer a request says it is, when it says one: as the file keeps it, the word's SHA-256, never the word. */
function saidComputer(req: IncomingMessage): string | undefined {
  const said = req.headers[COMPUTER_HEADER]
  return isComputerId(said) ? sha256(said) : undefined
}

/** The name a request says its computer has now, safe to show, when it says one. */
function saidComputerName(req: IncomingMessage): string | undefined {
  const said = req.headers[COMPUTER_NAME_HEADER]
  if (typeof said !== 'string') return undefined
  let name: string
  try {
    name = saidName(decodeURIComponent(said))
  } catch {
    return undefined
  }
  return name || undefined
}

/** How another computer's OpenAgent sends its key: the scheme of its `Authorization` header. */
const BEARER = /^Bearer +(\S+)$/i

export interface DoorOptions {
  env: NodeJS.ProcessEnv
  /** OpenAgent's own address on this computer: `http://127.0.0.1:4200`. */
  target: string
  port: number
  /** The address to bind; every network of this computer when unsaid. */
  host?: string
  /** Who may knock, by the address a request comes from; an address on one of this computer's own networks when unsaid. */
  knocks?: (peer: string | undefined) => boolean
  /** The key and certificate the door speaks HTTPS with; plain HTTP when unsaid. */
  secured?: Secured
  /**
   * Set when the door is reached through a program on this computer that speaks HTTPS for it
   * (Tailscale's Serve, tailscale.ts): a browser sees an HTTPS door, and each request's caller is
   * the one that program names in `X-Forwarded-For`, not the program itself.
   */
  proxied?: boolean
  /**
   * Where a browser opens the door, as an origin, when its requests may name another address
   * (behind a program that passes them on): `https://laptop.tail1234.ts.net`. A page of the door
   * is one of that origin; the address each request names (`Host`) when unsaid.
   */
  origin?: string
  /** How this computer's name on the network is read, for the code an allowed computer is handed; the real network when unsaid. */
  address?: AddressDeps
  /** What takes a computer's line, and the ports such computers are given; a door with none gives no line. */
  lines?: {
    take(id: string, socket: Duplex, head: Buffer): void
    ports: { from: number; count: number }
    /** Whether a computer keeps its line open right now. */
    connected(id: string): boolean
    /** Ask a computer down its line, at its own person's address or the one it has for `person`; false when it has no such address. */
    pass(id: string, person: string | undefined, path: string, req: IncomingMessage, res: ServerResponse): boolean
  }
  now?: () => number
  /** How long a look at an ask is held open for its answer; for a test that cannot wait. */
  askHoldMs?: number
  /** This computer's name, as its owner named it, said to a person's own OpenAgent with each call passed to it; nothing while it is not known. */
  ownersName?: () => string | undefined
}

export interface Door {
  readonly port: number
  /** Cut what a device that is no longer in still holds open (a live feed). */
  dropRemoved(store: Store): void
  /** Speak with a renewed certificate from the next connection on. Only for a door that speaks HTTPS. */
  renew(secured: Secured): void
  close(): Promise<void>
}

/** The cookie as it is set: on a door that speaks HTTPS, one a browser never sends over plain HTTP. */
function cookieHeader(entry: Entry, secure: boolean): string {
  return `${DEVICE_COOKIE}=${keyWord(entry)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_S}${secure ? '; Secure' : ''}`
}

/** A device's id and key as one word, the way a cookie and a computer's header carry them. */
function keyWord(entry: Entry): string {
  return `${entry.id}.${entry.key}`
}

/** What such a word holds; `undefined` for a word that is not one. */
export function readKeyWord(word: string): Entry | undefined {
  const dot = word.indexOf('.')
  return dot > 0 && dot < word.length - 1 ? { id: word.slice(0, dot), key: word.slice(dot + 1) } : undefined
}

/** The device a request says it is, by its cookie. */
export function readEntry(header: string | undefined): Entry | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== DEVICE_COOKIE) continue
    const entry = readKeyWord(part.slice(eq + 1).trim())
    if (entry) return entry
  }
  return undefined
}

/** The computer a request says it is, by its `Authorization` header. */
export function readBearer(header: string | undefined): Entry | undefined {
  const word = BEARER.exec(header ?? '')?.[1]
  return word ? readKeyWord(word) : undefined
}

/** A computer's name as it said it, safe to show. */
function saidName(said: string): string {
  return said.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 60)
}

/** A computer's name as the list of devices shows it. */
function computerName(said: string): string {
  return `OpenAgent on ${saidName(said)}`
}

/** A `Cookie` header without the door's own cookie: OpenAgent never sees a device's key. */
function withoutDeviceCookie(header: string | undefined): string | undefined {
  const kept = (header ?? '')
    .split(';')
    .map(part => part.trim())
    .filter(part => part && part.slice(0, part.indexOf('=')).trim() !== DEVICE_COOKIE)
  return kept.length ? kept.join('; ') : undefined
}

/**
 * Whether a request comes from the page the door served: one with no `Origin` (a navigation, a
 * plain read) or with the door's own address as the browser knows it. A page on another site
 * that makes this device's browser call the door is turned away here.
 */
function fromOwnPage(req: IncomingMessage, secure: boolean, own?: string): boolean {
  const origin = req.headers.origin
  return !origin || origin === (own ?? `${secure ? 'https' : 'http'}://${req.headers.host ?? ''}`)
}

function refuse(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(text)
}

function sendPage(res: ServerResponse, status: number, html: string, nonce?: string): void {
  res
    .writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'${nonce ? `; script-src 'nonce-${nonce}'` : ''}`,
    })
    .end(html)
}

async function readBody(req: IncomingMessage, limit: number): Promise<string | undefined> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) return undefined
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** What a device is told of itself here (`ME_PATH`). */
export interface Me {
  /** Its person's name; absent while the computer has no persons, when every device is the one person's. */
  person?: string
  /** Whether that person is the computer's owner: always so while it has no persons. */
  owner: boolean
  /** That person's devices, as `status` lists them: a computer once. */
  devices: ListedDevice[]
  /** To a computer whose line is for everyone here: every person here, the owner first, by their name. */
  persons?: string[]
}

/**
 * What `person`'s device is told of itself: their name, whether they own the computer, and
 * their devices. A computer whose line is for everyone is told who everyone is, so it knows who
 * of those it gave a user of their own is no longer here.
 */
export function me(store: Store, person: string | undefined, forEveryone = false): Me {
  const owner = store.persons.find(candidate => candidate.owner)?.name
  return {
    ...(person !== undefined ? { person } : {}),
    owner: person === undefined || person === owner,
    devices: listedDevices(store).filter(device => device.person === person),
    ...(forEveryone ? { persons: store.persons.map(candidate => candidate.name) } : {}),
  }
}

/** The headers that are about one connection, not about the request: never passed on. */
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'upgrade']

/** Open the door on `port`. Rejects when the port cannot be bound. */
export async function openDoor(opts: DoorOptions): Promise<Door> {
  const { env } = opts
  const now = opts.now ?? Date.now
  const knocks = opts.knocks ?? (peer => onOwnNetwork(peer))
  const secure = opts.secured !== undefined || opts.proxied === true
  const kind: DoorKind = opts.secured ? 'server' : opts.proxied ? 'tailscale' : 'wifi'
  const ownTarget = new URL(opts.target)
  // Who a request is from: behind a program that passes it on, the caller that program names (the
  // last address it added), else the socket's other end. Only a program on this computer reaches a
  // door behind one, so the name is that program's to give.
  const callerOf = (req: IncomingMessage): string => {
    const forwarded = opts.proxied ? req.headers['x-forwarded-for'] : undefined
    const last = (Array.isArray(forwarded) ? forwarded.at(-1) : forwarded)?.split(',').at(-1)?.trim()
    return last || (req.socket.remoteAddress ?? '')
  }

  // The file as last read, read again only once it has changed: a device removed a moment ago is
  // out at its next request.
  let cached: { stamp: string; store: Store } | undefined
  const currentStore = async (): Promise<Store> => {
    const stamp = await stat(storePath(env)).then(s => `${s.mtimeMs}:${s.size}`, () => 'none')
    if (cached?.stamp !== stamp) cached = { stamp, store: await readStore(env) }
    return cached.store
  }

  const sockets = new Map<string, Set<Socket>>()
  const seen = new Map<string, number>()
  // Which computer each device that called with its key says it is: written with the times, for an entry that does not say yet.
  const said = new Map<string, string>()
  // The name each computer that called with its key said last: its entries are named again only when it says another.
  const names = new Map<string, string>()
  const cookieSent = new Map<string, number>()
  // When each address last tried wrong codes, within the last minute. Only the guesser waits: the code itself goes on working.
  const wrongTries = new Map<string, number[]>()
  const triesOf = (peer: string): number[] => {
    const recent = (wrongTries.get(peer) ?? []).filter(at => now() - at < WRONG_TRIES_MS)
    if (recent.length) wrongTries.set(peer, recent)
    else wrongTries.delete(peer)
    return recent
  }
  const triedWrong = (peer: string): void => {
    for (const other of [...wrongTries.keys()]) triesOf(other)
    wrongTries.set(peer, [...triesOf(peer), now()])
  }

  const flushSeen = async (): Promise<void> => {
    if (seen.size === 0) return
    const times = new Map(seen)
    const computers = new Map(said)
    seen.clear()
    said.clear()
    await update(env, store => {
      for (const device of store.devices) {
        const at = times.get(device.id)
        if (at !== undefined) device.seen = new Date(at).toISOString()
        // Said once and kept: a computer that got in before it said which one it is, is listed once from here on.
        // Never beside an entry of the same kind that says the same: a computer holds one key for OpenAgent and
        // one line, and a second key under its name would be one the list does not show.
        const computer = computers.get(device.id)
        const held = (other: Store['devices'][number]): boolean => other !== device && other.computer === computer && (other.line !== undefined) === (device.line !== undefined)
        if (computer !== undefined && device.computer === undefined && !store.devices.some(held)) device.computer = computer
      }
    }).catch(() => {
      // Not written: a line says which computer it is only when it is asked for, so its word is kept for the next write.
      for (const [id, computer] of computers) if (!said.has(id)) said.set(id, computer)
    })
  }
  const letIn = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const nonce = randomBytes(16).toString('base64')
      return sendPage(res, 200, enterPage(ENTER_PATH, nonce, kind), nonce)
    }
    if (req.method !== 'POST') return refuse(res, 405, 'method not allowed')
    if (!fromOwnPage(req, secure, opts.origin)) return refuse(res, 403, 'forbidden')
    const body = await readBody(req, MAX_ENTER_BODY)
    let code: unknown
    let computer: unknown
    let line: unknown
    try {
      ;({ code, computer, line } = JSON.parse(body ?? '') as { code?: unknown; computer?: unknown; line?: unknown })
    } catch {
      code = undefined
    }
    // A computer says its own name; a browser is named by what it says it is.
    const byComputer = typeof computer === 'string' && computer.trim() !== ''
    // A computer that gets in to keep a line open is listed by its own name: it is what this server starts runs on.
    const forLine = byComputer && line === true
    if (forLine && !opts.lines) return refuse(res, 403, 'this door gives no line: only a server does')
    // Asked before the code is looked at: an address that is waiting is not told whether its next guess was right.
    const peer = callerOf(req)
    if (triesOf(peer).length >= WRONG_TRIES) return refuse(res, 429, TOO_MANY_TRIES)
    const name = forLine ? saidName(computer as string) : byComputer ? computerName(computer as string) : deviceName(req.headers['user-agent'])
    const entry = typeof code === 'string' && code ? await enter(env, code, name, now(), forLine ? opts.lines!.ports : undefined, byComputer ? saidComputer(req) : undefined) : undefined
    if (!entry) {
      triedWrong(peer)
      return refuse(res, 403, 'this code no longer works')
    }
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' }
    // A computer is answered its key; a browser gets it as a cookie its pages cannot read.
    if (byComputer) return void res.writeHead(200, headers).end(JSON.stringify({ ok: true, key: keyWord(entry) }))
    cookieSent.set(entry.id, now())
    // Whose device it is, for the page to say: the owner's when no person is named.
    const person = entry.person ?? (await currentStore()).persons[0]?.name
    res.writeHead(200, { ...headers, 'set-cookie': cookieHeader(entry, secure) }).end(JSON.stringify({ ok: true, ...(person !== undefined ? { person } : {}) }))
  }

  /**
   * A computer on this Wi-Fi asks to get in (POST, with its name), looks whether it was allowed
   * (GET, held open a while), or takes its ask away (DELETE), by the secret it was given. Only a
   * door on the Wi-Fi takes asks: a server's is open to every network, where anyone who knows its
   * address would knock. A computer asks, never a page: a site this computer's browser opens puts
   * no popup on its screen.
   */
  const asking = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.headers.origin !== undefined || req.headers.cookie !== undefined) return refuse(res, 403, 'forbidden')
    const json = (value: unknown): void => void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value))
    if (req.method === 'POST') {
      let computer: unknown
      try {
        ;({ computer } = JSON.parse((await readBody(req, MAX_ENTER_BODY)) ?? '') as { computer?: unknown })
      } catch {
        computer = undefined
      }
      if (typeof computer !== 'string' || !saidName(computer)) return refuse(res, 400, 'say which computer asks: {"computer": "its name"}')
      const asked = await addAsk(env, saidName(computer), plainAddress(req.socket.remoteAddress ?? ''), now())
      if (asked === 'denied') return refuse(res, 429, ASK_DENIED)
      if (asked === 'busy') return refuse(res, 503, ASK_BUSY)
      return json({ secret: asked.secret, number: asked.ask.number, expires: asked.ask.expires })
    }
    const secret = BEARER.exec(req.headers.authorization ?? '')?.[1]
    if (!secret) return refuse(res, 401, 'say which ask: its secret, as Authorization: Bearer')
    req.resume()
    if (req.method === 'DELETE') {
      await dropAsk(env, secret, now())
      return json({ ok: true })
    }
    if (req.method !== 'GET') return refuse(res, 405, 'method not allowed')
    let left = false
    req.socket.once('close', () => void (left = true))
    const until = Date.now() + (opts.askHoldMs ?? ASK_HOLD_MS)
    for (;;) {
      const ask = askOf(await currentStore(), secret, now())
      if (!ask) return json({ state: 'gone' })
      if (ask.answer === 'denied') return json({ state: 'denied' })
      if (ask.answer === 'allowed') {
        // Taken away as it is heard: the code is handed once.
        if ((await dropAsk(env, secret, now()))?.answer !== 'allowed') return json({ state: 'gone' })
        const { code } = await addCode(env, now())
        const port = (server.address() as AddressInfo).port
        // By this computer's name on the network when it has one, as every code here is; by the number it was asked at too.
        const name = await nameAddress(opts.address)
        const asked = req.headers.host ?? `${urlHost(plainAddress(req.socket.localAddress ?? ''))}:${port}`
        const link = (host: string): string => `http://${host}${ENTER_PATH}#${code}`
        return json({ state: 'allowed', link: link(name ? `${urlHost(name)}:${port}` : asked), ...(name ? { numberLink: link(asked) } : {}) })
      }
      if (left || Date.now() >= until) return json({ state: 'waiting', expires: ask.expires })
      await new Promise(resolve => setTimeout(resolve, ASK_LOOK_MS))
    }
  }

  /**
   * Who a request comes from, when it is in: a computer by the key its header carries, a device
   * by its cookie. A header that is no key of the door's is the page's own, to pass on.
   */
  const whoIsIn = async (req: IncomingMessage): Promise<{ entry: Entry; byBearer: boolean; person?: string; owner: boolean; port?: number } | undefined> => {
    const store = await currentStore()
    const whose = (entry: Entry): { person?: string; owner: boolean; port?: number } => {
      const device = store.devices.find(candidate => candidate.id === entry.id)
      const person = device && personOf(store, device)
      const port = portOf(store, person)
      return { ...(person !== undefined ? { person } : {}), owner: device?.person === undefined, ...(port !== undefined ? { port } : {}) }
    }
    const bearer = readBearer(req.headers.authorization)
    if (bearer && isIn(store, bearer)) return { entry: bearer, byBearer: true, ...whose(bearer) }
    const cookie = readEntry(req.headers.cookie)
    return cookie && isIn(store, cookie) ? { entry: cookie, byBearer: false, ...whose(cookie) } : undefined
  }

  /** A device that is in takes itself out: what a computer does when it is removed from the other's list of machines. */
  const leave = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!fromOwnPage(req, secure, opts.origin)) return refuse(res, 403, 'forbidden')
    const who = await whoIsIn(req)
    if (!who) return refuse(res, 401, 'this device is not in')
    await removeDevice(env, who.entry.id)
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"ok":true}')
  }

  const passOn = (req: IncomingMessage, res: ServerResponse, entry: Entry, byBearer: boolean, person: string | undefined, port: number | undefined): void => {
    // A person with an OpenAgent of their own is passed to it, on this computer only; everyone else to the one that started the door.
    const target = port !== undefined ? new URL(`http://127.0.0.1:${port}`) : ownTarget
    const headers: OutgoingHttpHeaders = { ...req.headers }
    for (const name of HOP_HEADERS) delete headers[name]
    // OpenAgent never sees a key, a computer's no more than a device's, nor what a computer says it is to this door.
    if (byBearer) delete headers.authorization
    delete headers[COMPUTER_HEADER]
    delete headers[COMPUTER_NAME_HEADER]
    // Who the call is from is the door's to say, never the request's, and so is this computer's name.
    delete headers[PERSON_HEADER]
    delete headers[OWNERS_NAME_HEADER]
    const owners = port !== undefined ? opts.ownersName?.() : undefined
    if (owners !== undefined) headers[OWNERS_NAME_HEADER] = encodeURIComponent(owners)
    // A name is any language's letters: a header carries only plain ones.
    if (person !== undefined) headers[PERSON_HEADER] = nameWord(person)
    // OpenAgent is asked as its own browser asks it: at its own address, from its own page.
    headers.host = target.host
    if (headers.origin) headers.origin = target.origin
    delete headers.referer
    const cookie = withoutDeviceCookie(req.headers.cookie)
    if (cookie) headers.cookie = cookie
    else delete headers.cookie

    const upstream = httpRequest({ hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers }, answer => {
      const answered: OutgoingHttpHeaders = { ...answer.headers }
      for (const name of HOP_HEADERS) delete answered[name]
      if (!byBearer && now() - (cookieSent.get(entry.id) ?? 0) > COOKIE_RESEND_MS) {
        cookieSent.set(entry.id, now())
        const own = answered['set-cookie']
        answered['set-cookie'] = [...(Array.isArray(own) ? own : own ? [String(own)] : []), cookieHeader(entry, secure)]
      }
      res.writeHead(answer.statusCode ?? 502, answered)
      // A live feed's first line may be a while away: the headers go now.
      res.flushHeaders()
      answer.pipe(res)
      // An answer OpenAgent cut midway is cut here too, so the page asks again instead of waiting for ever.
      answer.once('error', () => res.destroy())
      answer.once('close', () => {
        if (!answer.complete) res.destroy()
      })
    })
    upstream.on('error', () => {
      if (!res.headersSent) refuse(res, 502, 'OpenAgent did not answer')
      else res.destroy()
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      if (!knocks(req.socket.remoteAddress)) return refuse(res, 403, 'only a device on the same network as this computer gets in')
      const path = (req.url ?? '/').split('?')[0] ?? '/'
      if (path === ENTER_PATH) return req.method === 'DELETE' ? leave(req, res) : letIn(req, res)
      if (path === ASK_PATH && !secure) return asking(req, res)
      if (opts.lines && (path === COMPUTERS_PATH || path.startsWith(`${VIA_PREFIX}/`))) return throughLine(req, res, path)
      if (path === ME_PATH || path === ME_REMOVE_PATH || path === ME_LINE_PATH || path === ME_CODE_PATH) return aboutMe(req, res, path)
      if (path === DOOR_PREFIX || path.startsWith(`${DOOR_PREFIX}/`)) return refuse(res, 404, 'not found')

      const who = await whoIsIn(req)
      if (!who) {
        const wantsPage = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')
        return wantsPage ? sendPage(res, 401, notInPage(kind)) : refuse(res, 401, 'this device is not in')
      }
      if (!fromOwnPage(req, secure, opts.origin)) return refuse(res, 403, 'forbidden')

      const { entry, byBearer, person, owner, port } = who
      seen.set(entry.id, now())
      // Only a computer says which one it is: a page's word for it is not taken.
      const computer = byBearer ? saidComputer(req) : undefined
      // The first word counts: what an entry says it is, is not changed by what its key's holder says later.
      if (computer !== undefined && !said.has(entry.id)) said.set(entry.id, computer)
      // A computer's name is its own, said with every call: renamed there, it is listed here by the new one.
      const heard = byBearer ? saidComputerName(req) : undefined
      if (heard !== undefined && names.get(entry.id) !== heard) {
        names.set(entry.id, heard)
        void nameComputer(env, entry.id, device => (device.line ? heard : computerName(heard))).catch(() => names.delete(entry.id))
      }
      let held = sockets.get(entry.id)
      if (!held) sockets.set(entry.id, (held = new Set()))
      if (!held.has(req.socket)) {
        const socket = req.socket
        held.add(socket)
        socket.once('close', () => held.delete(socket))
      }
      // OpenAgent shows the person at the page: the owner's own device is the owner at their own page, said by nobody.
      passOn(req, res, entry, byBearer, owner ? undefined : person, port)
    })().catch(() => {
      if (!res.headersSent) refuse(res, 500, 'the door failed')
      else res.destroy()
    })
  }
  /**
   * Another computer's OpenAgent reaches the computers on a line here: their list, or one call to
   * one of them. Only a computer that is in with its key, never a page: a browser has no business
   * here. A computer is not offered itself.
   */
  const throughLine = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    if (req.headers.origin !== undefined || req.headers.cookie !== undefined) return refuse(res, 403, 'forbidden')
    const store = await currentStore()
    const bearer = readBearer(req.headers.authorization)
    const caller = bearer && isIn(store, bearer) ? store.devices.find(device => device.id === bearer.id) : undefined
    if (!caller) return refuse(res, 401, 'this device is not in')
    seen.set(caller.id, now())
    // The computers of the caller's own person, and those whose line is for everyone here with an
    // address for them: a person's computer at home runs their runs, and its person's own choice
    // of whose else.
    const person = personOf(store, caller)
    const own = (device: Store['devices'][number]): boolean => personOf(store, device) === person
    const others = store.devices.filter(device => device.line && (own(device) || (person !== undefined && device.line.others?.[person] !== undefined)) && (caller.computer === undefined || device.computer !== caller.computer))
    if (path === COMPUTERS_PATH) {
      if (req.method !== 'GET') return refuse(res, 405, 'method not allowed')
      const computers = others.map(device => {
        const whose = own(device) ? undefined : personOf(store, device)
        return { id: device.id, name: device.name, online: opts.lines!.connected(device.id), ...(whose !== undefined ? { owner: whose } : {}) }
      })
      return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ computers }))
    }
    const rest = path.slice(VIA_PREFIX.length + 1)
    const slash = rest.indexOf('/')
    const id = slash === -1 ? rest : rest.slice(0, slash)
    const computer = others.find(device => device.id === id)
    if (!computer || slash === -1) return refuse(res, 404, 'no computer on a line here has that id')
    const query = (req.url ?? '').slice((req.url ?? '').split('?')[0]!.length)
    // Asked at the address the computer has for the caller's person: what goes down the line says it is for them.
    if (!opts.lines!.pass(id, own(computer) ? undefined : person, `${rest.slice(slash)}${query}`, req, res)) refuse(res, 404, 'no computer on a line here has that id')
  }

  /**
   * A device that is in asks who it is here, takes one of its own person's devices out, or, for a
   * computer, asks for a code its line gets in with, or one a device of its person gets in with. A
   * computer asks with its key; a page with its cookie, from the door's own page only, and never
   * for a code: a browser keeps no line, and a phone shows its own person's code from that person's
   * computer.
   * What a device is told and may do is its own person's, as the door says, whatever it asks.
   */
  const aboutMe = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    const who = await whoIsIn(req)
    if (!who) return refuse(res, 401, 'this device is not in')
    if (who.byBearer ? req.headers.origin !== undefined || req.headers.cookie !== undefined : !fromOwnPage(req, secure, opts.origin)) return refuse(res, 403, 'forbidden')
    seen.set(who.entry.id, now())
    const json = (status: number, value: unknown): void => void res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value))
    const whose = { person: who.person }
    if (path === ME_PATH) {
      if (req.method !== 'GET') return refuse(res, 405, 'method not allowed')
      const store = await currentStore()
      const forEveryone = store.devices.find(device => device.id === who.entry.id)?.line?.others !== undefined
      return json(200, me(store, who.person, forEveryone))
    }
    if (req.method !== 'POST') return refuse(res, 405, 'method not allowed')
    if (path === ME_REMOVE_PATH) {
      const body = await readBody(req, MAX_ENTER_BODY)
      let id: unknown
      try {
        ;({ id } = JSON.parse(body ?? '') as { id?: unknown })
      } catch {
        id = undefined
      }
      if (typeof id !== 'string' || !id) return refuse(res, 400, 'say which device: {"id": "…"}')
      if (!(await removeComputer(env, id, whose))) return refuse(res, 404, 'no device of yours has that id')
      return json(200, me(await currentStore(), who.person))
    }
    // A code for a line, or for a device of the computer's person: only a computer asks, and only a
    // door with an address to say where: a server's, or one behind Tailscale.
    const forLine = path === ME_LINE_PATH
    if (!who.byBearer || (forLine && !opts.lines)) return refuse(res, 403, forLine ? 'only a computer that is in at a server asks for a line' : 'only a computer that is in asks for a code')
    req.resume()
    const store = await currentStore()
    const owner = store.persons.find(person => person.owner)?.name
    if (opts.proxied && store.tailscale) {
      const { code, expires } = await addCode(env, now(), who.person === owner ? undefined : who.person)
      // Tailscale's certificate is one every device trusts: nothing of the door's key follows the code.
      return json(200, { url: `https://${store.tailscale.address}${ENTER_PATH}#${code}`, where: store.tailscale.address, code: shownCode(code), expires })
    }
    const fingerprint = await doorFingerprint(env)
    if (!store.https || !fingerprint) return refuse(res, 503, 'the door has no address or no key yet')
    const { code, expires } = await addCode(env, now(), who.person === owner ? undefined : who.person, forLine)
    const port = (server.address() as AddressInfo).port
    const where = `${urlHost(store.https.address)}${port === 443 ? '' : `:${port}`}`
    return json(200, { url: `https://${where}${ENTER_PATH}#${code}.${fingerprint}`, where, code: shownCode(code), expires })
  }

  /**
   * A computer asks for its line: it is given one when its key lets it in and it got in for a
   * line. The connection is then the line's, and nothing of the door's is said on it again.
   */
  const giveLine = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // The connection is this function's from here on, its errors too: a caller that leaves midway ends only itself.
    socket.on('error', () => socket.destroy())
    // Answered and closed from this side: a connection taken over is no longer under the door's own time limits, and a caller that stays would hold one of its places for good.
    const no = (status: number, text: string): void => void socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy())
    void (async () => {
      const path = (req.url ?? '/').split('?')[0]
      if (!opts.lines || path !== LINE_PATH || req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== LINE_PROTOCOL) return no(404, 'Not Found')
      if (!knocks(req.socket.remoteAddress)) return no(403, 'Forbidden')
      // A browser has no business here: a page cannot hold a line, and is not let try.
      if (req.headers.origin !== undefined || req.headers.cookie !== undefined) return no(403, 'Forbidden')
      const store = await currentStore()
      const bearer = readBearer(req.headers.authorization)
      const device = bearer && isIn(store, bearer) ? store.devices.find(candidate => candidate.id === bearer.id) : undefined
      if (!device) return no(401, 'Unauthorized')
      if (!device.line) return no(403, 'Forbidden')
      // For everyone here, or for its own person only, as the computer says each time it asks: an
      // address for each other person, or none. Written before the line is taken, so the addresses
      // are there by the time OpenAgent is told of the line.
      const everyone = req.headers[LINE_FOR_HEADER] === 'everyone'
      const ports = opts.lines.ports
      // Looked at on a copy first: a line that calls again as it was changes nothing, and writes nothing.
      const looked = structuredClone(store)
      const changes = everyone ? shareLine(looked, looked.devices.find(candidate => candidate.id === device.id)!, ports) : device.line.others !== undefined
      if (changes) {
        await update(env, kept => {
          const line = kept.devices.find(candidate => candidate.id === device.id)
          if (!line?.line) return
          if (everyone) shareLine(kept, line, ports)
          else delete line.line.others
        })
      }
      // Gone while the file was read: there is no line to give.
      if (socket.destroyed) return
      seen.set(device.id, now())
      const computer = saidComputer(req)
      if (computer !== undefined && !said.has(device.id)) said.set(device.id, computer)
      let held = sockets.get(device.id)
      if (!held) sockets.set(device.id, (held = new Set()))
      held.add(socket as Socket)
      socket.once('close', () => held.delete(socket as Socket))
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: ${LINE_PROTOCOL}\r\n\r\n`)
      opts.lines.take(device.id, socket, head)
    })().catch(() => socket.destroy())
  }
  // A caller that takes a connection and says nothing is not waited for long.
  const server: Server | SecureServer = opts.secured ? createSecureServer({ ...opts.secured, handshakeTimeout: 15_000 }, handle) : createServer(handle)
  // Only a door that gives lines takes a connection over: any other answers such a request as it answers every request.
  if (opts.lines) server.on('upgrade', giveLine)
  server.headersTimeout = 15_000
  // Open to every network, the door takes a bounded number of callers at once.
  if (opts.secured) server.maxConnections = 1024

  const listen = (host: string): Promise<void> =>
    new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(opts.port, host, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  if (opts.host !== undefined) await listen(opts.host)
  // Both families at once where the computer has IPv6: a name on the network may answer with either.
  else await listen('::').catch(err => ((err as NodeJS.ErrnoException).code === 'EAFNOSUPPORT' ? listen('0.0.0.0') : Promise.reject(err)))

  // Started only once the door listens: a door that could not be opened leaves nothing behind.
  const flushTimer = setInterval(() => void flushSeen(), SEEN_FLUSH_MS)
  flushTimer.unref()

  return {
    port: (server.address() as AddressInfo).port,
    renew(secured) {
      if (opts.secured) (server as SecureServer).setSecureContext(secured)
    },
    dropRemoved(store) {
      const stillIn = new Set(store.devices.map(device => device.id))
      for (const [id, held] of sockets) {
        if (stillIn.has(id)) continue
        for (const socket of held) socket.destroy()
        sockets.delete(id)
      }
    },
    async close() {
      clearInterval(flushTimer)
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await flushSeen()
    },
  }
}

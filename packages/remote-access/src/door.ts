import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import { createServer as createSecureServer, type Server as SecureServer } from 'node:https'
import type { AddressInfo, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { onOwnNetwork } from './address.js'
import type { Secured } from './certificate.js'
import { deviceName } from './device-name.js'
import { LINE_PATH, LINE_PROTOCOL } from './line-out.js'
import { enterPage, notInPage } from './pages.js'
import { enter, isIn, readStore, removeDevice, storePath, update, type Entry, type Store } from './store.js'

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
 */

/** Every path of the door's own; never passed on. */
export const DOOR_PREFIX = '/_remote-access'
/** Where a scanned code lands, and where its page sends the code. */
export const ENTER_PATH = `${DOOR_PREFIX}/enter`
/** The cookie a device that is in carries: its id, a dot, its key. */
export const DEVICE_COOKIE = 'oa_device'

/** As long as a browser keeps a cookie at most; sent again before it runs out, so a device stays in until it is removed. */
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60
const COOKIE_RESEND_MS = 24 * 60 * 60 * 1000
/** How often the times the devices were last seen are written to the file. */
const SEEN_FLUSH_MS = 60_000
/** A code, a computer's name and their wrapping, generously. */
const MAX_ENTER_BODY = 4 * 1024
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
  /** What takes a computer's line, and the ports such computers are given; a door with none gives no line. */
  lines?: { take(id: string, socket: Duplex, head: Buffer): void; ports: { from: number; count: number } }
  now?: () => number
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

function readKeyWord(word: string): Entry | undefined {
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
function fromOwnPage(req: IncomingMessage, secure: boolean): boolean {
  const origin = req.headers.origin
  return !origin || origin === `${secure ? 'https' : 'http'}://${req.headers.host ?? ''}`
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

/** The headers that are about one connection, not about the request: never passed on. */
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'upgrade']

/** Open the door on `port`. Rejects when the port cannot be bound. */
export async function openDoor(opts: DoorOptions): Promise<Door> {
  const { env } = opts
  const now = opts.now ?? Date.now
  const knocks = opts.knocks ?? (peer => onOwnNetwork(peer))
  const secure = opts.secured !== undefined
  const target = new URL(opts.target)

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
  const cookieSent = new Map<string, number>()

  const flushSeen = async (): Promise<void> => {
    if (seen.size === 0) return
    const times = new Map(seen)
    seen.clear()
    await update(env, store => {
      for (const device of store.devices) {
        const at = times.get(device.id)
        if (at !== undefined) device.seen = new Date(at).toISOString()
      }
    }).catch(() => {})
  }
  const letIn = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const nonce = randomBytes(16).toString('base64')
      return sendPage(res, 200, enterPage(ENTER_PATH, nonce, secure), nonce)
    }
    if (req.method !== 'POST') return refuse(res, 405, 'method not allowed')
    if (!fromOwnPage(req, secure)) return refuse(res, 403, 'forbidden')
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
    const name = forLine ? saidName(computer as string) : byComputer ? computerName(computer as string) : deviceName(req.headers['user-agent'])
    const entry = typeof code === 'string' && code ? await enter(env, code, name, now(), forLine ? opts.lines!.ports : undefined) : undefined
    if (!entry) return refuse(res, 403, 'this code no longer works')
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' }
    // A computer is answered its key; a browser gets it as a cookie its pages cannot read.
    if (byComputer) return void res.writeHead(200, headers).end(JSON.stringify({ ok: true, key: keyWord(entry) }))
    cookieSent.set(entry.id, now())
    res.writeHead(200, { ...headers, 'set-cookie': cookieHeader(entry, secure) }).end('{"ok":true}')
  }

  /**
   * Who a request comes from, when it is in: a computer by the key its header carries, a device
   * by its cookie. A header that is no key of the door's is the page's own, to pass on.
   */
  const whoIsIn = async (req: IncomingMessage): Promise<{ entry: Entry; byBearer: boolean } | undefined> => {
    const store = await currentStore()
    const bearer = readBearer(req.headers.authorization)
    if (bearer && isIn(store, bearer)) return { entry: bearer, byBearer: true }
    const cookie = readEntry(req.headers.cookie)
    return cookie && isIn(store, cookie) ? { entry: cookie, byBearer: false } : undefined
  }

  /** A device that is in takes itself out: what a computer does when it is removed from the other's list of machines. */
  const leave = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!fromOwnPage(req, secure)) return refuse(res, 403, 'forbidden')
    const who = await whoIsIn(req)
    if (!who) return refuse(res, 401, 'this device is not in')
    await removeDevice(env, who.entry.id)
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"ok":true}')
  }

  const passOn = (req: IncomingMessage, res: ServerResponse, entry: Entry, byBearer: boolean): void => {
    const headers: OutgoingHttpHeaders = { ...req.headers }
    for (const name of HOP_HEADERS) delete headers[name]
    // OpenAgent never sees a key, a computer's no more than a device's.
    if (byBearer) delete headers.authorization
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
      if (path === DOOR_PREFIX || path.startsWith(`${DOOR_PREFIX}/`)) return refuse(res, 404, 'not found')

      const who = await whoIsIn(req)
      if (!who) {
        const wantsPage = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')
        return wantsPage ? sendPage(res, 401, notInPage(secure)) : refuse(res, 401, 'this device is not in')
      }
      if (!fromOwnPage(req, secure)) return refuse(res, 403, 'forbidden')

      const { entry, byBearer } = who
      seen.set(entry.id, now())
      let held = sockets.get(entry.id)
      if (!held) sockets.set(entry.id, (held = new Set()))
      if (!held.has(req.socket)) {
        const socket = req.socket
        held.add(socket)
        socket.once('close', () => held.delete(socket))
      }
      passOn(req, res, entry, byBearer)
    })().catch(() => {
      if (!res.headersSent) refuse(res, 500, 'the door failed')
      else res.destroy()
    })
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
      // Gone while the file was read: there is no line to give.
      if (socket.destroyed) return
      seen.set(device.id, now())
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
      if (secure) (server as SecureServer).setSecureContext(secured)
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

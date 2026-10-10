import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { onOwnNetwork } from './address.js'
import { deviceName } from './device-name.js'
import { enterPage, notInPage } from './pages.js'
import { enter, isIn, readStore, storePath, update, type Entry, type Store } from './store.js'

/**
 * The door: the one thing that listens on the network. A request from a device that is in is
 * passed to OpenAgent on this computer as it came, and answered with what OpenAgent answered; so
 * a device that is in sees and does what this computer's own browser does. Anything else gets
 * one of the door's two pages, or a refusal.
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
/** A code and its wrapping, generously. */
const MAX_ENTER_BODY = 4 * 1024

export interface DoorOptions {
  env: NodeJS.ProcessEnv
  /** OpenAgent's own address on this computer: `http://127.0.0.1:4200`. */
  target: string
  port: number
  /** The address to bind; every network of this computer when unsaid. */
  host?: string
  /** Who may knock, by the address a request comes from; an address on one of this computer's own networks when unsaid. */
  knocks?: (peer: string | undefined) => boolean
  now?: () => number
}

export interface Door {
  readonly port: number
  /** Cut what a device that is no longer in still holds open (a live feed). */
  dropRemoved(store: Store): void
  close(): Promise<void>
}

function cookieHeader(entry: Entry): string {
  return `${DEVICE_COOKIE}=${entry.id}.${entry.key}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`
}

/** The device a request says it is, by its cookie. */
export function readEntry(header: string | undefined): Entry | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== DEVICE_COOKIE) continue
    const value = part.slice(eq + 1).trim()
    const dot = value.indexOf('.')
    if (dot > 0 && dot < value.length - 1) return { id: value.slice(0, dot), key: value.slice(dot + 1) }
  }
  return undefined
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
function fromOwnPage(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  return !origin || origin === `http://${req.headers.host ?? ''}`
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
      return sendPage(res, 200, enterPage(ENTER_PATH, nonce), nonce)
    }
    if (req.method !== 'POST') return refuse(res, 405, 'method not allowed')
    if (!fromOwnPage(req)) return refuse(res, 403, 'forbidden')
    const body = await readBody(req, MAX_ENTER_BODY)
    let code: unknown
    try {
      code = (JSON.parse(body ?? '') as { code?: unknown }).code
    } catch {
      code = undefined
    }
    const entry = typeof code === 'string' && code ? await enter(env, code, deviceName(req.headers['user-agent']), now()) : undefined
    if (!entry) return refuse(res, 403, 'this code no longer works')
    cookieSent.set(entry.id, now())
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': cookieHeader(entry) }).end('{"ok":true}')
  }

  const passOn = (req: IncomingMessage, res: ServerResponse, entry: Entry): void => {
    const headers: OutgoingHttpHeaders = { ...req.headers }
    for (const name of HOP_HEADERS) delete headers[name]
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
      if (now() - (cookieSent.get(entry.id) ?? 0) > COOKIE_RESEND_MS) {
        cookieSent.set(entry.id, now())
        const own = answered['set-cookie']
        answered['set-cookie'] = [...(Array.isArray(own) ? own : own ? [String(own)] : []), cookieHeader(entry)]
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

  const server: Server = createServer((req, res) => {
    void (async () => {
      if (!knocks(req.socket.remoteAddress)) return refuse(res, 403, 'only a device on the same network as this computer gets in')
      const path = (req.url ?? '/').split('?')[0] ?? '/'
      if (path === ENTER_PATH) return letIn(req, res)
      if (path === DOOR_PREFIX || path.startsWith(`${DOOR_PREFIX}/`)) return refuse(res, 404, 'not found')

      const entry = readEntry(req.headers.cookie)
      if (!entry || !isIn(await currentStore(), entry)) {
        const wantsPage = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')
        return wantsPage ? sendPage(res, 401, notInPage()) : refuse(res, 401, 'this device is not in')
      }
      if (!fromOwnPage(req)) return refuse(res, 403, 'forbidden')

      seen.set(entry.id, now())
      let held = sockets.get(entry.id)
      if (!held) sockets.set(entry.id, (held = new Set()))
      if (!held.has(req.socket)) {
        const socket = req.socket
        held.add(socket)
        socket.once('close', () => held.delete(socket))
      }
      passOn(req, res, entry)
    })().catch(() => {
      if (!res.headersSent) refuse(res, 500, 'the door failed')
      else res.destroy()
    })
  })

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

import { request as httpRequest, type ClientRequest } from 'node:http'
import { isIP } from 'node:net'
import type { Duplex } from 'node:stream'
import { connect } from 'node:tls'
import { keyFingerprint } from './der.js'
import { DATA, END, HEAD, Link, RESET, carriedHeaders, carriedPath, carriedValue, readHead, sendBody, type Frame } from './frames.js'

/**
 * This computer's end of a line: it calls its server, says who it is with the key it has there,
 * and keeps the connection open. What the server then asks comes down the connection and is
 * passed to OpenAgent on this computer as a machine's call arrives; the answer goes back up. So
 * a phone on the server's page can start a run here while nothing on a network reaches this
 * computer.
 *
 * Only what a machine is asked (`/_relay/…`) is passed on. When the person lets the server only
 * watch, every call says so to OpenAgent, which then answers what reads and refuses what acts.
 */

/** Where a computer asks the door for a line, and what it asks to speak there. */
export const LINE_PATH = '/_remote-access/line'
export const LINE_PROTOCOL = 'openagent-line'
/** Said to OpenAgent with a call that may only read. */
export const WATCH_HEADER = 'x-openagent-watch'
const CARRIED_HEADERS: readonly string[] = ['content-type', 'accept']

/** How often this computer asks whether the line still carries, and after how long with no answer it calls again. */
export const LINE_PING_MS = 15_000
export const LINE_QUIET_MS = 45_000
/** How long the server gets to take the connection, show its key, and answer the first words. */
const DIAL_MS = 15_000
const MAX_ANSWER_HEAD = 8 * 1024
/** How many calls a server has open on one line at once, at most: a page has a handful, a flood is refused. */
const MAX_CALLS = 256

export const NOT_THE_SERVER = 'what answers at this address is not the server the line was set up with'

/** The door said no: this computer's key there no longer lets it in, or lets it in without a line. */
export class NotLetIn extends Error {}

/** Connect to the server, and go on only once it has shown the key it is known by: nothing is said to anyone else. */
export function dial(url: string, pin: string, signal?: AbortSignal): Promise<Duplex> {
  const target = new URL(url)
  const host = target.hostname.replace(/^\[|\]$/g, '')
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: Number(target.port) || 443, ...(isIP(host) ? {} : { servername: host }), rejectUnauthorized: false })
    const fail = (err: Error): void => {
      signal?.removeEventListener('abort', givenUp)
      socket.destroy()
      reject(err)
    }
    const givenUp = (): void => fail(new Error('the call was given up on'))
    if (signal?.aborted) return givenUp()
    signal?.addEventListener('abort', givenUp, { once: true })
    socket.setTimeout(DIAL_MS, () => fail(new Error('the server did not answer')))
    socket.once('error', fail)
    socket.once('secureConnect', () => {
      signal?.removeEventListener('abort', givenUp)
      socket.removeListener('error', fail)
      // Whoever reads the connection next takes its errors; one that comes before that only ends it.
      socket.on('error', () => socket.destroy())
      socket.setTimeout(0)
      const shown = socket.getPeerX509Certificate()
      if (!shown || keyFingerprint(shown.publicKey) !== pin) return fail(new Error(NOT_THE_SERVER))
      resolve(socket)
    })
  })
}

/**
 * Ask the door for a line with this computer's key there. Answers what arrived after the door's
 * yes, which is already the line's. Throws {@link NotLetIn} on the door's no.
 */
export function knock(socket: Duplex, url: string, key: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let heard = Buffer.alloc(0)
    const timer = setTimeout(() => done(new Error('the server did not answer')), DIAL_MS)
    const done = (err?: Error, rest?: Buffer): void => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('close', onClose)
      socket.off('error', onClose)
      if (err) {
        socket.destroy()
        reject(err)
      } else resolve(rest!)
    }
    const onClose = (): void => done(new Error('the server ended the connection'))
    const onData = (chunk: Buffer): void => {
      heard = Buffer.concat([heard, chunk])
      const end = heard.indexOf('\r\n\r\n')
      if (end === -1) return heard.length > MAX_ANSWER_HEAD ? done(new Error('the server answered something else than a line')) : undefined
      const status = /^HTTP\/1\.1 (\d{3})/.exec(heard.subarray(0, end).toString('latin1'))?.[1]
      if (status === '101') {
        // Nothing is read until the line's own reader is there to take it.
        socket.pause()
        return done(undefined, heard.subarray(end + 4))
      }
      done(status === '401' || status === '403' ? new NotLetIn('this computer is no longer let in there for a line') : new Error(`the server answered ${status ?? 'something else than a line'}`))
    }
    socket.on('data', onData)
    socket.once('close', onClose)
    socket.once('error', onClose)
    socket.write(`GET ${LINE_PATH} HTTP/1.1\r\nHost: ${new URL(url).host}\r\nConnection: Upgrade\r\nUpgrade: ${LINE_PROTOCOL}\r\nAuthorization: Bearer ${key}\r\n\r\n`)
  })
}

export interface CarryOptions {
  /** OpenAgent's own address on this computer. */
  target: string
  /** Whether the server may only read right now: asked for each call. */
  watch: () => boolean
  pingMs?: number
  quietMs?: number
}

/** Pass what comes down the line to OpenAgent on this computer, until the line ends. */
export function carry(socket: Duplex, rest: Buffer, opts: CarryOptions): Promise<void> {
  const target = new URL(opts.target)
  return new Promise(resolve => {
    const calls = new Map<number, ClientRequest>()
    const say = (call: number, status: number, text: string): void => {
      link.send(HEAD, call, Buffer.from(JSON.stringify({ status, headers: { 'content-type': 'text/plain; charset=utf-8' } })))
      link.send(DATA, call, Buffer.from(text))
      link.send(END, call)
    }
    const begin = (call: number, payload: Buffer): void => {
      const head = readHead(payload)
      const { method, path, headers } = (head ?? {}) as { method?: unknown; path?: unknown; headers?: unknown }
      // Checked here again, whatever the server checked: this computer decides what reaches its OpenAgent.
      if (typeof path !== 'string' || !carriedPath(path)) return say(call, 404, 'not found')
      // A read, or a call with a body, and no other kind: a body on any other kind of call leaves
      // here without its length, and OpenAgent would read it as a second call nobody checked.
      if (method !== 'GET' && method !== 'POST') return say(call, 405, 'method not allowed')
      if (calls.size >= MAX_CALLS) return say(call, 503, 'too many calls at once')
      const said = (headers && typeof headers === 'object' ? headers : {}) as Record<string, unknown>
      const passed: Record<string, string> = { host: target.host }
      for (const name of CARRIED_HEADERS) {
        const value = carriedValue(said[name])
        if (value !== undefined) passed[name] = value
      }
      if (opts.watch()) passed[WATCH_HEADER] = '1'
      let answered = false
      let upstream: ClientRequest
      // Whether this call is still the one under its number: a number the server uses again is the newer call's.
      const forget = (): boolean => calls.get(call) === upstream && calls.delete(call)
      try {
        upstream = httpRequest({ hostname: target.hostname, port: target.port, method, path, headers: passed }, res => {
          answered = true
          link.send(HEAD, call, Buffer.from(JSON.stringify({ status: res.statusCode ?? 502, headers: carriedHeaders(res.headers) })))
          sendBody(link, call, res).then(
            () => {
              forget()
              // Answered before the server ended its asking: nothing more of it is waited for.
              if (!upstream.writableEnded) upstream.destroy()
            },
            () => {
              // OpenAgent cut its answer midway: the server's caller is told, so it asks again.
              if (forget()) link.send(RESET, call)
              upstream.destroy()
            },
          )
        })
      } catch {
        // A call that cannot be made as it was asked is the server's fault, and ends this one call.
        return say(call, 400, 'bad request')
      }
      // Every error of it, not the first alone: a call the server goes on writing to after its end fails more than once.
      upstream.on('error', () => {
        upstream.destroy()
        if (!forget()) return
        if (answered) link.send(RESET, call)
        else say(call, 502, 'OpenAgent did not answer')
      })
      calls.set(call, upstream)
      // A read has no body: it is asked whole, at once, and what the server sends after it is not written.
      if (method === 'GET') upstream.end()
    }
    const link: Link = new Link(socket, {
      pingMs: opts.pingMs ?? LINE_PING_MS,
      quietMs: opts.quietMs ?? LINE_QUIET_MS,
      onFrame: ({ kind, call, payload }: Frame) => {
        if (kind === HEAD) return calls.has(call) ? undefined : begin(call, payload)
        const upstream = calls.get(call)
        if (!upstream) return
        if (kind === DATA) {
          // Nothing is written to a call whose asking has ended: a late piece is dropped.
          if (upstream.writableEnded || upstream.destroyed) return
          // Until it is written, or until the call's asking ended: a call that has ended says so, and never that it drained.
          if (!upstream.write(payload)) link.hold(new Promise(done => upstream.once('drain', done).once('finish', done).once('close', done)))
        } else if (kind === END) {
          if (!upstream.writableEnded) upstream.end()
        } else if (kind === RESET) {
          calls.delete(call)
          upstream.destroy()
        }
      },
      onClose: () => {
        for (const upstream of calls.values()) upstream.destroy()
        calls.clear()
        resolve()
      },
    })
    if (rest.length) link.take(rest)
    socket.resume()
  })
}

export interface KeepLineOptions {
  /** The server's door, as an origin. */
  url: string
  pin: string
  /** This computer's id and key there, as one word. */
  key: string
  target: string
  watch: () => boolean
  /** Ends the line for good. */
  signal: AbortSignal
  log?: (line: string) => void
  /** How long to wait before calling again, by how many calls in a row failed. */
  retryMs?: readonly number[]
  pingMs?: number
  quietMs?: number
}

const RETRY_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000]
/** A line that held this long was a line: the next call is made at once. */
const HELD_MS = 30_000

/** Keep a line open to one server until `signal` aborts: call, carry, and call again when it ends. */
export async function keepLine(opts: KeepLineOptions): Promise<void> {
  const log = opts.log ?? (() => {})
  const retry = opts.retryMs ?? RETRY_MS
  const host = new URL(opts.url).host
  let failed = 0
  let told: string | undefined
  while (!opts.signal.aborted) {
    const began = Date.now()
    try {
      const socket = await dial(opts.url, opts.pin, opts.signal)
      const rest = await knock(socket, opts.url, opts.key)
      if (opts.signal.aborted) return void socket.destroy()
      log(`remote-access: a line is open to ${host}`)
      told = undefined
      const end = (): void => void socket.destroy()
      opts.signal.addEventListener('abort', end, { once: true })
      await carry(socket, rest, opts)
      opts.signal.removeEventListener('abort', end)
      if (opts.signal.aborted) return
      log(`remote-access: the line to ${host} ended; calling again`)
    } catch (err) {
      if (opts.signal.aborted) return
      const why = err instanceof Error ? err.message : String(err)
      // Said once, not at every call: a server that is off for the night fails the same way all night.
      if (why !== told) log(`remote-access: no line to ${host}: ${why}`)
      told = why
      // A no is not asked again in a hurry: nothing changes it but the person.
      if (err instanceof NotLetIn) failed = retry.length
    }
    failed = Date.now() - began > HELD_MS ? 0 : failed + 1
    const wait = retry[Math.min(failed, retry.length) - 1] ?? 0
    await new Promise<void>(resolve => {
      const timer = setTimeout(done, wait)
      function done(): void {
        clearTimeout(timer)
        opts.signal.removeEventListener('abort', done)
        resolve()
      }
      opts.signal.addEventListener('abort', done, { once: true })
    })
  }
}

/** A body sent in pieces, each after its length, put together. */
export function unchunked(said: Buffer): Buffer {
  const pieces: Buffer[] = []
  for (let at = 0; ; ) {
    const lineEnd = said.indexOf('\r\n', at)
    const size = lineEnd === -1 ? 0 : parseInt(said.subarray(at, lineEnd).toString('latin1'), 16)
    // A length that is none ends the reading, a negative one as much as a missing one.
    if (!(size > 0)) return Buffer.concat(pieces)
    pieces.push(said.subarray(lineEnd + 2, lineEnd + 2 + size))
    at = lineEnd + 2 + size + 2
  }
}

/** One question to the door over a connection made for it, and its answer. */
function exchange(socket: Duplex, method: string, url: URL, headers: Record<string, string>, body = ''): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let heard = Buffer.alloc(0)
    const timer = setTimeout(() => socket.destroy(new Error('the server did not answer')), DIAL_MS)
    socket.on('data', (chunk: Buffer) => {
      heard = Buffer.concat([heard, chunk])
      if (heard.length > 64 * 1024) socket.destroy(new Error('the server answered too much'))
    })
    socket.once('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    // The door is asked to close after its answer: what was heard by then is the whole of it.
    socket.once('close', () => {
      clearTimeout(timer)
      const end = heard.indexOf('\r\n\r\n')
      const head = heard.subarray(0, Math.max(end, 0)).toString('latin1')
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1])
      if (end === -1 || !status) return reject(new Error('the server ended the connection'))
      const said = heard.subarray(end + 4)
      resolve({ status, body: (/^transfer-encoding:\s*chunked\s*$/im.test(head) ? unchunked(said) : said).toString('utf8') })
    })
    const lines = [`${method} ${url.pathname} HTTP/1.1`, `Host: ${url.host}`, 'Connection: close', `Content-Length: ${Buffer.byteLength(body)}`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`)]
    socket.write(`${lines.join('\r\n')}\r\n\r\n${body}`)
  })
}

/** What a server's link for a new machine says, when it is one a line can be asked for with. */
export interface LineLink {
  /** The server's door, as an origin. */
  url: string
  /** Where a computer is let in there, and takes itself out. */
  door: string
  code: string
  pin: string
}

/** Read a server's link. Only a server gives a line: a link that is not HTTPS, or names no key, is none. */
export function readLineLink(pasted: string): LineLink | undefined {
  try {
    const url = new URL(pasted.trim())
    const [code, pin] = url.hash.slice(1).split('.')
    return url.protocol === 'https:' && code && pin ? { url: url.origin, door: url.origin + url.pathname, code, pin } : undefined
  } catch {
    return undefined
  }
}

/** Get in at a server's door to keep a line open there: the link's code is spent, and this computer's key there is answered. */
export async function enterForLine(link: LineLink, name: string): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  try {
    const socket = await dial(link.url, link.pin)
    const answer = await exchange(socket, 'POST', new URL(link.door), { 'Content-Type': 'application/json' }, JSON.stringify({ code: link.code, computer: name, line: true }))
    if (answer.status !== 200) return { ok: false, error: answer.body.trim().slice(0, 200) || `the server answered ${answer.status}` }
    const { key } = JSON.parse(answer.body) as { key?: unknown }
    return typeof key === 'string' && key ? { ok: true, key } : { ok: false, error: 'the server answered no key' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Take this computer out at a server's door: its key there stops working. False when the server could not be told. */
export async function leaveLine(line: { url: string; pin: string; key: string }, door: string): Promise<boolean> {
  try {
    const socket = await dial(line.url, line.pin)
    const answer = await exchange(socket, 'DELETE', new URL(door), { Authorization: `Bearer ${line.key}` })
    // A key the server no longer knows is out already.
    return answer.status === 200 || answer.status === 401
  } catch {
    return false
  }
}

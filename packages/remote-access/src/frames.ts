import type { Duplex } from 'node:stream'

/**
 * What a line carries. A line is one connection a computer opened to its server and keeps
 * open, so the server can ask that computer's OpenAgent things although nothing on the network
 * reaches the computer. The server sends each call down it under a number of its own, and the
 * computer answers under the same number, so many calls share the one connection.
 *
 * A frame is nine bytes and what they announce: what the frame is, the call's number, and how
 * many bytes follow.
 */

/** A call's first frame each way: the request, then the answer's status and headers, as JSON. */
export const HEAD = 1
/** A piece of a call's body, either way. */
export const DATA = 2
/** A body's end, either way. */
export const END = 3
/** A call given up on by the side that says so: nothing more comes or is wanted under its number. */
export const RESET = 4
/** Asked by the computer, answered by the server: what tells both that the line still carries. */
export const PING = 5
export const PONG = 6

export interface Frame {
  kind: number
  call: number
  payload: Buffer
}

/** The most one frame carries: a body is cut into pieces of this size, so no call holds the line for long. */
export const MAX_PAYLOAD = 64 * 1024
const HEADER = 9
const NOTHING = Buffer.alloc(0)
/**
 * How much may wait to be sent on one line before the line is dropped, in bytes and in frames: a
 * frame of a few bytes costs far more memory than its bytes while it waits.
 */
const MAX_WAITING = 32 * 1024 * 1024
const MAX_WAITING_FRAMES = 8_192

export function frame(kind: number, call: number, payload: Buffer = NOTHING): Buffer {
  const header = Buffer.allocUnsafe(HEADER)
  header.writeUInt8(kind, 0)
  header.writeUInt32BE(call, 1)
  header.writeUInt32BE(payload.length, 5)
  return payload.length ? Buffer.concat([header, payload]) : header
}

/** Frames out of the bytes a connection hands over, in whatever pieces they arrive. Throws on a frame no line sends. */
export class FrameReader {
  private kept: Buffer = NOTHING

  push(chunk: Buffer): Frame[] {
    this.kept = this.kept.length ? Buffer.concat([this.kept, chunk]) : chunk
    const frames: Frame[] = []
    while (this.kept.length >= HEADER) {
      const size = this.kept.readUInt32BE(5)
      if (size > MAX_PAYLOAD) throw new Error('a frame larger than a line carries')
      if (this.kept.length < HEADER + size) break
      frames.push({ kind: this.kept.readUInt8(0), call: this.kept.readUInt32BE(1), payload: this.kept.subarray(HEADER, HEADER + size) })
      this.kept = this.kept.subarray(HEADER + size)
    }
    return frames
  }
}

export interface LinkOptions {
  /** Each frame that is a call's; a ping is answered and a pong is counted here. */
  onFrame: (frame: Frame) => void
  /** The connection ended, whoever ended it. Called once. */
  onClose: () => void
  /** How often this end asks whether the line still carries; an end that only answers leaves it unsaid. */
  pingMs?: number
  /** After how long with nothing heard the line is taken for dead. */
  quietMs: number
}

/**
 * One end of a line: frames in, frames out, and the watch that ends a line nothing comes over
 * any more (a computer that went to sleep says nothing, and its connection would otherwise stay
 * for hours).
 */
export class Link {
  private readonly reader = new FrameReader()
  private readonly ping: NodeJS.Timeout | undefined
  private readonly watch: NodeJS.Timeout
  private heard = Date.now()
  private held = 0
  private waiting = 0
  private closed = false

  constructor(
    private readonly socket: Duplex,
    private readonly opts: LinkOptions,
  ) {
    socket.on('data', (chunk: Buffer) => this.take(chunk))
    socket.once('close', () => this.ended())
    socket.once('error', () => socket.destroy())
    this.ping = opts.pingMs !== undefined ? setInterval(() => this.send(PING, 0), opts.pingMs) : undefined
    this.watch = setInterval(
      () => {
        if (Date.now() - this.heard > opts.quietMs) socket.destroy()
      },
      Math.max(50, Math.floor(opts.quietMs / 4)),
    )
    this.ping?.unref()
    this.watch.unref()
  }

  /** What arrived before the line was handed over. */
  take(chunk: Buffer): void {
    if (this.closed) return
    this.heard = Date.now()
    let frames: Frame[]
    try {
      frames = this.reader.push(chunk)
    } catch {
      return void this.socket.destroy()
    }
    try {
      // However many times it was asked in one piece, the line says once that it still carries.
      if (frames.some(one => one.kind === PING)) this.send(PONG, 0)
      for (const one of frames) if (one.kind !== PING && one.kind !== PONG) this.opts.onFrame(one)
    } catch {
      // Whatever the other end sent, it ends its line at most: never the process that reads it.
      this.socket.destroy()
    }
  }

  /** Send one frame. False when the connection is full: the sender waits for {@link drained} before it sends more of that body. */
  send(kind: number, call: number, payload?: Buffer): boolean {
    if (this.closed) return false
    // An end that asks and asks and reads no answer is left: what waits for it is never let grow without end.
    if (this.socket.writableLength > MAX_WAITING || this.waiting > MAX_WAITING_FRAMES) {
      this.socket.destroy()
      return false
    }
    this.waiting++
    return this.socket.write(frame(kind, call, payload), () => void this.waiting--)
  }

  /** Once what was sent has left this computer. */
  drained(): Promise<void> {
    if (this.closed || !this.socket.writableNeedDrain) return Promise.resolve()
    return new Promise(resolve => {
      const done = (): void => {
        this.socket.off('drain', done)
        this.socket.off('close', done)
        resolve()
      }
      this.socket.once('drain', done)
      this.socket.once('close', done)
    })
  }

  /**
   * Read nothing more until `until` settles: a reader of one call that cannot keep up holds the
   * whole line, which is what keeps this end from piling up what it cannot hand on.
   */
  hold(until: Promise<unknown>): void {
    if (this.closed) return
    if (this.held++ === 0) this.socket.pause()
    const release = (): void => {
      if (--this.held === 0 && !this.closed) this.socket.resume()
    }
    until.then(release, release)
  }

  get open(): boolean {
    return !this.closed
  }

  close(): void {
    this.socket.destroy()
  }

  private ended(): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.ping)
    clearInterval(this.watch)
    this.opts.onClose()
  }
}

/** Send a body as frames, a piece at a time, waiting whenever the connection is full. */
export async function sendBody(link: Link, call: number, body: AsyncIterable<Buffer | string>): Promise<void> {
  for await (const piece of body) {
    const bytes = typeof piece === 'string' ? Buffer.from(piece) : piece
    for (let at = 0; at < bytes.length; at += MAX_PAYLOAD) {
      if (!link.open) return
      if (!link.send(DATA, call, bytes.subarray(at, at + MAX_PAYLOAD))) await link.drained()
    }
  }
  link.send(END, call)
}

/** The headers that are about one connection, not about the call: never carried. */
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length'])

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/** A header's value as HTTP takes it: text with no line break and nothing else that ends a header. */
const isHeaderValue = (value: unknown): value is string => typeof value === 'string' && value.length <= 8_192 && !/[\x00-\x08\x0a-\x1f\x7f]/.test(value)
const MAX_HEADERS = 64

/**
 * An answer's headers as a line carries them: without what is about one connection, and without
 * anything that is no header. They come from the other end of the line, and a name or a value
 * HTTP does not take would stop the answer, or the process, where it is written.
 */
export function carriedHeaders(headers: unknown): Record<string, string | string[]> {
  const carried: Record<string, string | string[]> = {}
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return carried
  for (const [name, value] of Object.entries(headers as Record<string, unknown>).slice(0, MAX_HEADERS)) {
    if (!HEADER_NAME.test(name) || HOP_HEADERS.has(name.toLowerCase())) continue
    if (typeof value === 'number' && Number.isFinite(value)) carried[name] = String(value)
    else if (isHeaderValue(value)) carried[name] = value
    else if (Array.isArray(value) && value.length <= MAX_HEADERS && value.every(isHeaderValue)) carried[name] = value
  }
  return carried
}

/** One header of a request as a line carries it, or nothing for what is no header's value. */
export function carriedValue(value: unknown): string | undefined {
  return isHeaderValue(value) ? value : undefined
}

/** What a machine is asked: the only paths a line carries. */
const CARRIED = '/_relay/'

/**
 * Whether a path is one a line carries: what a machine is asked, spelled the one way. A path
 * that reads as another once its dots and slashes are worked out is none: what OpenAgent would
 * make of it is not what was checked here.
 */
export function carriedPath(path: string): boolean {
  if (!path.startsWith(CARRIED)) return false
  const [route, ...query] = path.split('?')
  // A query is letters, numbers and what an address escapes with: no blank, no line break.
  if (query.length > 1 || !/^[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/.test(query[0] ?? '')) return false
  try {
    return new URL(route!, 'http://line').pathname === route
  } catch {
    return false
  }
}

/** A call's first frame as JSON, or nothing for what is no such thing. */
export function readHead(payload: Buffer): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(payload.toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

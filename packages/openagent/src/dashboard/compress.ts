import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'

// What the dashboard sends goes gzipped to a browser that takes it: a phone on its own network,
// reaching a server through its door, waits for every byte of the page's code and of each answer,
// and text like these shrinks to an eighth. A short answer goes as it is.

const gzipped = promisify(gzip)

/** Below this a body goes as it is: gzip saves nothing worth its time. */
const SMALL = 1024

/** Whether the caller takes a gzipped answer: every browser says so. */
export function takesGzip(req: IncomingMessage): boolean {
  return /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''))
}

/** The types worth packing: text. A picture or a font is packed already. */
export function isText(contentType: string): boolean {
  return /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/.test(contentType)
}

/** `body` gzipped, once per `key`: a file of the page's code is packed the first time it is asked for. */
const packed = new Map<string, Promise<Buffer>>()

/** The tag a file is sent with, from its size and when it was last written: a file rebuilt in place gets a new one. */
export function fileTag(facts: { mtimeMs: number; size: number }): string {
  return `"${Math.floor(facts.mtimeMs).toString(36)}-${facts.size.toString(36)}"`
}

/**
 * Send `body`, gzipped when the caller takes it, it is text and not small. `key` names a body that
 * is the same each time it is sent (a file of the page), so it is packed once. A body sent with an
 * `etag` the browser already holds (it says so in `if-none-match`) is not sent again: a 304 tells
 * it to use its copy, which is what a reopened page does with every file of its code.
 */
export async function sendBody(req: IncomingMessage, res: ServerResponse, status: number, headers: OutgoingHttpHeaders, body: Buffer | string, key?: string): Promise<void> {
  if (status === 200 && headers.etag !== undefined && req.headers['if-none-match'] === headers.etag) {
    res.writeHead(304, { ...headers, vary: 'accept-encoding' })
    res.end()
    return
  }
  const raw = typeof body === 'string' ? Buffer.from(body) : body
  if (raw.length < SMALL || !takesGzip(req) || !isText(String(headers['content-type'] ?? ''))) {
    res.writeHead(status, { ...headers, vary: 'accept-encoding' })
    res.end(raw)
    return
  }
  let zipped: Promise<Buffer>
  if (key === undefined) zipped = gzipped(raw)
  else {
    zipped = packed.get(key) ?? gzipped(raw)
    packed.set(key, zipped)
  }
  res.writeHead(status, { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' })
  res.end(await zipped)
}

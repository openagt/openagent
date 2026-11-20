import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * The plumbing of the daemon's one HTTP surface past its RPC, the machine relay (`/_relay`):
 * plain-text statuses, JSON payloads, and capped JSON request bodies.
 */

/** Answer with a plain-text status line. */
export function end(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain', ...headers })
  res.end(message)
}

/** Answer with a JSON payload. */
export function sendJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

/**
 * Read a JSON body, refusing anything past the cap rather than buffering it. Rejects with
 * `body too large` on overflow and `body must be JSON` on anything unparseable, so a caller
 * learns which of the two it hit.
 */
export function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('body must be JSON'))
      }
    })
    req.on('error', () => reject(new Error('read failed')))
  })
}

/** Refuse anything but a GET, answering 405 itself. `false` means the request is already answered. */
export function requireGet(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET') return true
  end(res, 405, 'method not allowed', { allow: 'GET' })
  return false
}

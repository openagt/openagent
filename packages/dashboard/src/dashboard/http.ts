import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * The plumbing every one of the daemon's non-RPC HTTP surfaces shares: the browser bridge
 * (`/_bridge`), the web-start queue (`/_web-start`) and the machine relay (`/_relay`).
 *
 * All three answer plain-text statuses, JSON payloads, and read capped JSON request bodies, and
 * each carried its own copy — two body readers that differed only in which message they rejected
 * with, and three identical status responders.
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
 * `body too large` on overflow and `body must be JSON` on anything unparseable — the messages the
 * bridge and web-start routes answer 400 with, so a caller learns which of the two it hit.
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

/**
 * The preamble every POST route runs: refuse a non-POST, then read the body. Answers the request
 * itself on either failure and resolves `undefined`, so a caller's whole check is
 * `const body = await readPost(...); if (body === undefined) return`. JSON has no `undefined`, so
 * the sentinel cannot collide with a body that parsed.
 */
export async function readPost(req: IncomingMessage, res: ServerResponse, maxBytes: number): Promise<unknown> {
  if (req.method !== 'POST') {
    end(res, 405, 'method not allowed', { allow: 'POST' })
    return undefined
  }
  try {
    return await readJsonBody(req, maxBytes)
  } catch (err) {
    end(res, 400, (err as Error).message)
    return undefined
  }
}

/** Refuse anything but a GET, answering 405 itself. `false` means the request is already answered. */
export function requireGet(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET') return true
  end(res, 405, 'method not allowed', { allow: 'GET' })
  return false
}

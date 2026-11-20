import type { IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from 'node:http'
import type { Server as SecureServer } from 'node:https'

/**
 * The little HTTP the door's servers share: the door itself (door.ts), the addresses the
 * computers on a line are asked at (line-in.ts), and the proof a certificate office reads on a
 * server (serve.ts).
 */

/** Say no, in words, never kept by a cache. */
export function refuse(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(text)
}

/** Answer `value` as JSON, never kept by a cache. */
export function sendJson(res: ServerResponse, status: number, value: unknown, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(value))
}

/** A request's body as text; `undefined` once it is longer than `limit` bytes. */
export async function readBody(req: IncomingMessage, limit: number): Promise<string | undefined> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) return undefined
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** A request's body as the fields of a JSON object; none for a body that is longer than `limit` bytes, or is no JSON object. */
export async function readFields(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse((await readBody(req, limit)) ?? '')
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Listen on `port` at `host`, or on every network of this computer when unsaid: both families at
 * once where the computer has IPv6, as a name on the network may answer with either. Rejects when
 * the port cannot be had.
 */
export function listen(server: Server | SecureServer, port: number, host?: string): Promise<void> {
  const at = (on: string): Promise<void> =>
    new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, on, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  if (host !== undefined) return at(host)
  return at('::').catch(err => ((err as NodeJS.ErrnoException).code === 'EAFNOSUPPORT' ? at('0.0.0.0') : Promise.reject(err)))
}

/** Close a server, with every connection it still holds. */
export async function shut(server: Server | SecureServer): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

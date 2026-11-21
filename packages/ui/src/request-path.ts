import type { IncomingMessage } from 'node:http'

/**
 * A request's pathname, parsed defensively (#938). Node hands the request target through
 * verbatim, including absolute-form targets a proxy client may send (`GET http://[ ...`),
 * and `new URL` throws on those synchronously inside the request handler — an uncaught
 * exception that takes the whole daemon down. `undefined` means "no parseable path":
 * answer 400 (or serve the fallback), never throw.
 */
export function requestPathname(req: IncomingMessage): string | undefined {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    return undefined
  }
}

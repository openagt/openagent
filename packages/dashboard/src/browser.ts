import { createServer } from 'node:net'

/**
 * What launching a Chrome with its DevTools port open needs, whoever launches it: a port nobody
 * holds, and a way to know the port answers. The bridge browser (#1332) is the one caller.
 */

/** A free localhost port, asked of the OS rather than guessed. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('no port'))))
    })
  })
}

/**
 * Poll `/json/version` until Chrome answers. Chrome opens the port a beat after the process
 * starts, so connecting to a URL that is not listening yet is the obvious race.
 */
export async function waitForDebugEndpoint(
  browserUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const { timeoutMs = 15_000, intervalMs = 100, fetchImpl = fetch } = opts
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`${browserUrl}/json/version`)
      if (res.ok) return true
    } catch {
      // Not listening yet.
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

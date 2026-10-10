import { isLoopbackHost } from '../../src/client.js'

// Which daemon the dashboard is talking to. The page is served by its daemon and every transport
// is same-origin, so the browser's address IS the connection: a loopback address is this
// machine's own daemon, any other is another machine's, opened by its address.

/** This machine's own daemon, on the default port (daemon.ts). */
const LOCAL_ORIGIN = 'http://127.0.0.1:4200'

/** Navigate back to this machine's own loopback daemon. */
export function connectLocal(): void {
  globalThis.location?.assign(LOCAL_ORIGIN)
}

/** Which daemon the dashboard is on, for the connected indicator: this machine's own on a
 * loopback address, else the other machine by its address's host. */
export function currentConnection(host: string, hostname: string): { label: string; isLocal: boolean } {
  return isLoopbackHost(hostname) ? { label: 'Local', isLocal: true } : { label: host, isLocal: false }
}

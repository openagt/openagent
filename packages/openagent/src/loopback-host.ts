/**
 * Loopback-address helpers, for the RPC mount (rejecting a cross-origin page and a rebound `Host`).
 */

/** The `127.0.0.0/8` loopback range, in dotted-quad form. */
const LOOPBACK_V4 = /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/**
 * True when `host` is a loopback address the browser reaches without leaving the machine.
 * A bind-all (`0.0.0.0`, `::`) or a routable address is not.
 *
 * The IPv4 check matches the whole `127.0.0.0/8` range but only as an address: a bare
 * `startsWith('127.')` also accepts a *registrable name* like `127.evil.com`, which is exactly the
 * rebound `Host` the DNS-rebinding guard exists to reject (it can resolve to `127.0.0.1`).
 */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host === '[::1]' || LOOPBACK_V4.test(host)
}

/**
 * The hostname a `Host` header names, with the port dropped. Keeps the bracketed IPv6 form
 * (`[::1]:4200` → `[::1]`), which splitting on the first colon would mangle.
 */
export function hostnameFromHostHeader(header: string): string {
  if (header.startsWith('[')) {
    const close = header.indexOf(']')
    return close === -1 ? header : header.slice(0, close + 1)
  }
  const colon = header.indexOf(':')
  return colon === -1 ? header : header.slice(0, colon)
}

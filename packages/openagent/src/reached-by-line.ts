import { isLoopbackHost } from './loopback-host.js'

/**
 * Whether a saved machine is a person's own computer, reached by the line it keeps open to this
 * server. Such a computer sits behind a home network, where a server cannot call it: it calls
 * the server and keeps that one connection open, and the server serves an address on its own
 * loopback that stands for the computer. That address is what the machine is saved by, so a
 * saved machine whose address is a loopback origin is such a computer, and no other machine is:
 * every other one is saved by an address on a network.
 *
 * A leaf with no Node in it: the daemon says it of a run, and the dashboard draws such a machine
 * as a computer, not as a server, and has it removed under Devices, where the computer is taken out.
 */
export function reachedByLine(url: string): boolean {
  try {
    const at = new URL(url)
    return at.protocol === 'http:' && isLoopbackHost(at.hostname)
  } catch {
    return false
  }
}

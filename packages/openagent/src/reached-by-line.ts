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

/**
 * Where a server's door passes a call down the line of a computer that keeps one open there: a
 * computer at home that nothing on a network reaches is asked at this address, through the
 * server, with this computer's key at the server. To this computer it is one more machine.
 */
export const THROUGH_PATH = '/_devices/via/'

/** The server a saved machine is reached through, by its host (`165.245.244.10`); nothing for a machine reached by an address of its own. */
export function reachedThrough(url: string): string | undefined {
  const at = url.indexOf(THROUGH_PATH)
  if (at === -1) return undefined
  try {
    return new URL(url.slice(0, at)).host
  } catch {
    return undefined
  }
}

/**
 * A saved machine's own name, as a person says it: the name it was saved with, without the
 * "(through <server>)" a computer reached through a server is saved with, which its row says
 * apart.
 */
export function machineName(machine: { label: string; url: string }): string {
  const server = reachedThrough(machine.url)
  return server !== undefined ? machine.label.replace(` (through ${server})`, '') : machine.label
}

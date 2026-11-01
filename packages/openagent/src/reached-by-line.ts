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

/** What a saved machine is: a computer, a server at home reached through a server, another person's computer shared on a server, or a server. */
export type MachineKind = 'computer' | 'home' | 'shared' | 'server'

/**
 * What a saved machine is, and in a few words what and where, as every page says it: never the
 * address that stands for it here. A computer is one reached by its line, or by an address on its
 * network; a server is one that speaks HTTPS; an address that is the machine's own name is said once.
 */
export function machineKind(machine: { label: string; url: string; owner?: string | undefined; server?: boolean | undefined }): { kind: MachineKind; place: string } {
  const through = reachedThrough(machine.url)
  if (machine.owner !== undefined) return { kind: 'shared', place: `@${machine.owner}'s server${through !== undefined ? `, through ${through}` : ''}` }
  if (reachedByLine(machine.url)) return machine.server ? { kind: 'home', place: 'Server at home' } : { kind: 'computer', place: 'Your computer' }
  if (through !== undefined) return { kind: 'home', place: `Server at home, through ${through}` }
  let host = machine.url
  try {
    host = new URL(machine.url).host
  } catch {
    // An address that does not read as one is said as it is.
  }
  const server = machine.url.startsWith('https://')
  const word = server ? 'Server' : 'Computer'
  return { kind: server ? 'server' : 'computer', place: host === machine.label ? word : `${word}, ${host}` }
}

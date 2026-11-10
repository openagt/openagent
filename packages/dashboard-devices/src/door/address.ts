import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

/**
 * Where a phone finds this computer on the network it is on: by the computer's name
 * (`my-macbook.local`), which stays when the network hands it another number, and by its number
 * (`192.168.1.23`), which every phone can open. And who may knock: only an address on one of the
 * networks this computer is on itself. And a server's address, as a person types it and as the
 * files keep it.
 */

/** What reading the computer's network is done through; each defaults to the real one. */
export interface AddressDeps {
  interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>
  hostname?: () => string
  lookup?: (name: string) => Promise<string[]>
}

/** This computer's own name, as its host name says it without `.local`: what a server lists it under, and what the Wi-Fi is told and asked by. */
export function ownName(deps: AddressDeps = {}): string {
  return (deps.hostname ?? hostname)().replace(/\.local$/i, '') || 'A computer'
}

/** How long the name may take to answer: a name nobody answers to is asked on the network, slowly. */
const NAME_LOOKUP_MS = 1_500

function ownInterfaces(deps: AddressDeps): NetworkInterfaceInfo[] {
  return Object.values((deps.interfaces ?? networkInterfaces)()).flatMap(list => list ?? []).filter(info => !info.internal)
}

/** An address as a peer or an interface names it, without its zone (`fe80::1%en0`) and unmapped from IPv6 (`::ffff:192.168.1.5`). */
export function plainAddress(address: string): string {
  const unzoned = address.split('%')[0] ?? address
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(unzoned)
  return mapped ? mapped[1]! : unzoned
}

/** Every number this computer is at, its own loopback too. */
export function ownAddresses(deps: AddressDeps = {}): Set<string> {
  return new Set(['127.0.0.1', '::1', ...ownInterfaces(deps).map(info => plainAddress(info.address))])
}

/** This computer's number on the network: its first IPv4 address that a network handed out. */
export function numberAddress(deps: AddressDeps = {}): string | undefined {
  return ownInterfaces(deps).find(info => info.family === 'IPv4' && !info.address.startsWith('169.254.'))?.address
}

/**
 * This computer's name on the network, when it answers to one: its host name under `.local`,
 * taken only when the name resolves to one of this computer's own addresses, so a name some
 * other machine holds is never handed to a phone.
 */
export async function nameAddress(deps: AddressDeps = {}): Promise<string | undefined> {
  const host = (deps.hostname ?? hostname)().toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.local)?$/.test(host)) return undefined
  const name = host.endsWith('.local') ? host : `${host}.local`
  const own = new Set(ownInterfaces(deps).map(info => plainAddress(info.address)))
  const resolve = deps.lookup ?? (async (asked: string) => (await lookup(asked, { all: true })).map(found => found.address))
  let timer: NodeJS.Timeout | undefined
  const answered = await Promise.race([
    resolve(name).catch((): string[] => []),
    new Promise<string[]>(done => {
      timer = setTimeout(() => done([]), NAME_LOOKUP_MS)
    }),
  ])
  clearTimeout(timer)
  return answered.some(address => own.has(plainAddress(address))) ? name : undefined
}

/**
 * Whether `peer` is on one of the networks this computer is on: inside the range of one of its
 * own interfaces, or this computer itself. A computer with an address the whole internet can
 * reach is so not opened to it by a switch that says Wi-Fi.
 */
export function onOwnNetwork(peer: string | undefined, deps: AddressDeps = {}): boolean {
  if (!peer) return false
  const address = plainAddress(peer)
  const family = isIP(address) === 4 ? 'ipv4' : isIP(address) === 6 ? 'ipv6' : undefined
  if (!family) return false
  const networks = new BlockList()
  networks.addSubnet('127.0.0.0', 8, 'ipv4')
  networks.addAddress('::1', 'ipv6')
  for (const info of ownInterfaces(deps)) {
    const prefix = Number(info.cidr?.split('/')[1])
    if (!Number.isInteger(prefix)) continue
    networks.addSubnet(plainAddress(info.address), prefix, info.family === 'IPv4' ? 'ipv4' : 'ipv6')
  }
  return networks.check(address, family)
}

/** A host as a URL carries it: an IPv6 number in brackets. */
export function urlHost(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host
}

/** A server's door as a person types it, and as its links go: its number or name, with its port when that is not HTTPS's own. */
export function serverWhere(address: string, port: number): string {
  return `${urlHost(address)}${port === 443 ? '' : `:${port}`}`
}

/**
 * A server's number or name as the files keep it: what a certificate can be for, written the one
 * way a certificate office and a link both read it. A name in small letters; an IPv6 number in
 * its short form, with no zone and no IPv4 tail.
 */
export const isAddress = (value: unknown): value is string => typeof value === 'string' && addressOf(value) === value

/**
 * `said` as the files keep an address, or `undefined` for what is no server's number or name: the
 * door's file and that of the servers this computer sets up over SSH, so the two always read the
 * same; and nothing that a command could read as an option of its own passes.
 */
export function addressOf(said: string): string | undefined {
  if (said.length > 253) return undefined
  if (isIP(said) === 4) return said
  if (isIP(said) === 6) {
    if (said.includes('%') || said.includes('.')) return undefined
    return new URL(`http://[${said}]`).hostname.slice(1, -1)
  }
  return /^(?=.*[a-z])[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(said) ? said.toLowerCase() : undefined
}

/** Whether a name is one Tailscale gives a computer on a person's network: a name under `ts.net`. */
export function isTailscaleName(said: string): boolean {
  return /\.ts\.net$/.test(said) && addressOf(said) === said
}

/** A server's door as a line is kept under: an HTTPS origin, written the one way. */
export function isLineUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value
  } catch {
    return false
  }
}

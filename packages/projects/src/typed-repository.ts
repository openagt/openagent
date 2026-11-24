import { addressOfRemote } from '@openagt/agent-data/repository-address'

/**
 * What a person typed as a repository's address, read: `github.com/you/shop`, the same with
 * `https://` before it, `ssh://git@github.com/you/shop.git`, or `git@github.com:you/shop.git`.
 * Undefined for anything else: a folder on this disk, another kind of address, a name that could
 * be read as an option or lead out of the folder projects are cloned into. Pure, so the page can
 * tell an address from a search word as it is typed, before the daemon is asked anything.
 */
export interface TypedRepository {
  /** What git is given. */
  url: string
  /** The repository's one name on every machine: see `addressOfRemote`. */
  address: string
  /** The repository's own name, the last part of its path, in the letters typed. */
  name: string
}

const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i
const SEGMENT = /^[a-z0-9_][a-z0-9._~-]*$/i
const MAX_TYPED = 512

export function typedRepository(typed: string): TypedRepository | undefined {
  const said = typed.trim().replace(/\/+$/, '')
  if (!said || said.length > MAX_TYPED || /[\s\x00-\x1f\x7f]/.test(said)) return undefined
  const scp = /^([a-z0-9_][a-z0-9._-]*)@([^:/@]+):([^:].*)$/i.exec(said)
  const web = scp ? null : /^(?:(https|ssh):\/\/(?:([a-z0-9_][a-z0-9._-]*)@)?)?([^:/@]+)(?::(\d{1,5}))?\/(.+)$/i.exec(said)
  const [host, rest] = scp ? [scp[2]!, scp[3]!] : web ? [web[3]!, web[5]!] : []
  if (host === undefined || rest === undefined || !HOST.test(host) || !host.includes('.')) return undefined
  const segments = rest.split('/')
  if (!segments.every(segment => SEGMENT.test(segment))) return undefined
  const name = segments.at(-1)!.replace(/\.git$/i, '')
  if (!name || !SEGMENT.test(name)) return undefined
  const scheme = web?.[1]?.toLowerCase()
  // A user or a port is for SSH; a web address has neither, so no login rides in what was typed.
  if (web && scheme !== 'ssh' && (web[2] !== undefined || web[4] !== undefined)) return undefined
  // Written anew from its parts, so git is given the two kinds of address it is allowed, as it spells them.
  const url = scp ? said : scheme === 'ssh' ? `ssh://${web![2] !== undefined ? `${web![2]}@` : ''}${host}${web![4] !== undefined ? `:${web![4]}` : ''}/${rest}` : `https://${host}/${rest}`
  const address = addressOfRemote(url)
  return address ? { url, address, name } : undefined
}

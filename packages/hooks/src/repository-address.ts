/**
 * The one name a project has on every machine: where its repository was cloned from, as
 * `host/path` (`github.com/me/shop`). A project's id is made from its folder's path, which is
 * another path on another machine, so a run sent to a machine names its project by this.
 *
 * The same repository reads the same whichever way it was cloned: the scheme, a user before the
 * host, a port, a trailing `.git` or slash are dropped, and letters are lowered, since the git
 * hosts match names without regard to case. Not an address at all (a path on this disk, a
 * `file:` address) is none.
 *
 * What it does not see through: a host that serves the two ways under two names or two paths
 * (`ssh.github.com`, Azure DevOps). Such a project reads as two, and the other machine says it
 * does not have it.
 *
 * Pure: no node imports, so browser-side code can read an address too. The address of the
 * repository in a folder is asked of git, in `origin.ts`.
 */
export function addressOfRemote(remote: string): string | undefined {
  return spellingOfRemote(remote)?.toLowerCase()
}

/**
 * A remote's `host/path` in the letters it was written with: what another machine is given to
 * clone the repository from, since not every host matches names without regard to case. Undefined
 * wherever {@link addressOfRemote} is.
 */
export function spellingOfRemote(remote: string): string | undefined {
  const url = remote.trim().replace(/[?#].*$/, '')
  // `git@host:path`, the scp-like form: no scheme, a colon before the path.
  const scp = /^(?:[^/\s]*@)?([^:/\s@]+):(?!\/\/)(.+)$/.exec(url)
  const web = scp ? null : /^([a-z][a-z0-9+.-]*):\/\/(?:[^/\s]*@)?([^:/\s@]+)(?::\d+)?\/(.+)$/i.exec(url)
  if (web?.[1]!.toLowerCase() === 'file') return undefined
  const [host, rest] = scp ? [scp[1]!, scp[2]!] : web ? [web[2]!, web[3]!] : []
  // One letter before a colon is a drive (`C:\repo`), a folder on this disk.
  if (host === undefined || rest === undefined || host.length < 2) return undefined
  const path = rest.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  return path ? `${host}/${path}` : undefined
}

/** The host a remote's address is on; none for a folder on this disk. */
export function remoteHostOf(remote: string): string | undefined {
  return spellingOfRemote(remote)?.split('/')[0]?.toLowerCase()
}

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
  /** The repository's one name on every machine: see {@link addressOfRemote}. */
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

import { addressOfRemote } from '@openagt/agent-data'

/**
 * The address a person typed, as git is given it: a host's address as it is (`https://…`,
 * `git@host:path`), or `host/path` alone, read as the host's https address. Anything that is not a
 * repository on a host (a path on this disk, an option) is none.
 */
export function repositoryUrlOf(typed: string): string | undefined {
  const said = typed.trim()
  if (!said || said.startsWith('-')) return undefined
  if (addressOfRemote(said) !== undefined) return said
  const bare = said.replace(/\/+$/, '').replace(/\.git$/i, '')
  const https = `https://${bare}.git`
  return /^[^/\s:@]+\.[^/\s:@]+\/\S+$/.test(bare) && addressOfRemote(https) !== undefined ? https : undefined
}

/** The git hosts a person knows by name, by their address. */
const HOSTS: Record<string, string> = { 'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'bitbucket.org': 'Bitbucket', 'codeberg.org': 'Codeberg' }

/** The remote's host for a person, out of its address in git's spellings (`https://host/…`, `ssh://git@host:22/…`, `git@host:…`); none for a folder on this machine. */
export function remoteHostName(address: string): string | undefined {
  const trimmed = address.trim()
  // With a scheme the host follows it, and `file://` has none; without one only `host:path` names a host.
  const host = (trimmed.includes('://') ? trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)/i) : trimmed.match(/^(?:[^@/]+@)?([^/:]+):/))?.[1]?.toLowerCase()
  return host ? (HOSTS[host] ?? host) : undefined
}

/** The git hosts a person knows by name, by their address. */
const HOSTS: Record<string, string> = { 'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'bitbucket.org': 'Bitbucket', 'codeberg.org': 'Codeberg' }

/** The remote's host for a person, out of its address in git's spellings (`https://host/…`, `ssh://git@host:22/…`, `git@host:…`); none for a folder on this machine. */
export function remoteHostName(address: string): string | undefined {
  const trimmed = address.trim()
  // With a scheme the host follows it, and `file://` has none; without one only `host:path` names a host.
  const host = (trimmed.includes('://') ? trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)/i) : trimmed.match(/^(?:[^@/]+@)?([^/:]+):/))?.[1]?.toLowerCase()
  return host ? (HOSTS[host] ?? host) : undefined
}

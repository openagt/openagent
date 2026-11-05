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

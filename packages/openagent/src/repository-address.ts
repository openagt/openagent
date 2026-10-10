import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'

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
 */
export function addressOfRemote(remote: string): string | undefined {
  const url = remote.trim().replace(/[?#].*$/, '')
  // `git@host:path`, the scp-like form: no scheme, a colon before the path.
  const scp = /^(?:[^/\s]*@)?([^:/\s@]+):(?!\/\/)(.+)$/.exec(url)
  const web = scp ? null : /^([a-z][a-z0-9+.-]*):\/\/(?:[^/\s]*@)?([^:/\s@]+)(?::\d+)?\/(.+)$/i.exec(url)
  if (web?.[1]!.toLowerCase() === 'file') return undefined
  const [host, rest] = scp ? [scp[1]!, scp[2]!] : web ? [web[2]!, web[3]!] : []
  // One letter before a colon is a drive (`C:\repo`), a folder on this disk.
  if (host === undefined || rest === undefined || host.length < 2) return undefined
  const path = rest.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '').toLowerCase()
  return path ? `${host.toLowerCase()}/${path}` : undefined
}

/**
 * The address of the repository at `cwd`: its `origin` remote, the one every push goes to. A
 * project with no `origin`, or one that is a folder on this disk, has none and runs on this
 * machine only.
 */
export async function repositoryAddress(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  return git(['remote', 'get-url', 'origin'], cwd).then(addressOfRemote, () => undefined)
}

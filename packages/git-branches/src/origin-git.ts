import { nodeGitRunner, originUrl, remoteHostOf, type GitRunner } from '@openagt/agent-data'
import type { GitAccess } from '@openagt/hooks'

/** How git reaches a remote as an account: the distribution's `account.access`, as a module's host or its attention is given it. */
export type ReachRemote = (remote: string) => Promise<GitAccess | undefined>

/**
 * git for the talks of the repository at `dir` with its origin (a fetch, a push, a list of its
 * branches), as an account of OpenAgent's that reaches it, never the person's own login: plain
 * git for an origin that is a folder on this disk, which asks no login; none where no module has
 * an account for origin's host, so nothing is asked of origin then.
 */
export async function originGit(dir: string, reach: ReachRemote | undefined, git: GitRunner = nodeGitRunner()): Promise<GitRunner | undefined> {
  const url = await originUrl(dir, git)
  if (url === undefined) return undefined
  if (remoteHostOf(url) === undefined) return git
  const access = await reach?.(url).catch(() => undefined)
  return access ? nodeGitRunner(access.env) : undefined
}

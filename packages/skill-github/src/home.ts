import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'

/**
 * The project's page on GitHub (#489, #1820): derived from the `origin` remote, so the dashboard's
 * project bar can link straight to it. OpenAgent asks this command and never spells the host.
 */

/** The git host's name, as OpenAgent labels the link. */
export const GIT_HOST_NAME = 'GitHub'

/**
 * Normalize a git remote URL to an `https://github.com/<owner>/<repo>` URL, or undefined when
 * it is not a GitHub remote. Handles the scp-style (`git@github.com:o/r.git`), ssh
 * (`ssh://git@github.com/o/r.git`), and https (`https://github.com/o/r.git`) forms, dropping
 * a `.git` suffix, an embedded credential, and a trailing slash.
 */
export function homeUrlFromRemote(remote: string): string | undefined {
  const url = remote.trim()
  const match =
    url.match(/^git@github\.com:(.+?)$/) ||
    url.match(/^ssh:\/\/git@github\.com\/(.+?)$/) ||
    url.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/(.+?)$/)
  if (!match || !match[1]) return undefined
  const slug = match[1].replace(/\.git$/, '').replace(/\/$/, '')
  // Guard against a junk capture: a GitHub slug is `owner/repo`, both non-empty.
  if (!/^[^/]+\/[^/]+$/.test(slug)) return undefined
  return `https://github.com/${slug}`
}

/** The repo's GitHub URL from its `origin` remote, or undefined (no remote / not GitHub). */
export async function homeUrlFor(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  try {
    return homeUrlFromRemote(await git(['remote', 'get-url', 'origin'], cwd))
  } catch {
    return undefined
  }
}

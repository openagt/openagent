import { readProvidedCommand, runPackageCommand, type ProvidedCommand } from '@openagt/agent-data'
import { basicGitHosts, basicPackageNames } from './basic-skills.js'

/**
 * The project's git host (#1820), reached by declaration: whichever package declares
 * `"openagent": { "git-host": "<command>" }` answers the pull requests, and this tool runs that
 * command the way the dashboard runs any provided command. A package the project installed for it
 * comes first; else the git host among the basic skills every run gets, where it answers for the
 * project (`basic-skills.ts`), so a project with nothing installed has one too. Nothing here names
 * a git host or a package: a project with none has no pull requests to read back and nothing to
 * merge.
 *
 * Two questions this tool asks of it: which pull request a branch has, for the run's record, and
 * the merge of one, once a follow-up is done (`run.ts`).
 */

/** The pull request a branch has, as the record keeps it. */
export interface BranchRequest {
  number: number
  url: string
}

/** How merging a pull request went: armed on green, merged at once, watched by the git host package, or not at all. */
export type MergeOutcome = { outcome: 'auto-armed' | 'merged' | 'watching' } | { outcome: 'failed'; error: string }

/** What a run asks of the git host; a test may hand in its own. */
export interface GitHost {
  /** The newest pull request whose head is `branch`, open or closed; none when there is none, no git host, or the git host could not tell. */
  requestOfBranch(repo: string, branch: string): Promise<BranchRequest | undefined>
  /** Land pull request `number`: armed to merge on green, or merged at once. */
  mergeRequest(repo: string, number: number): Promise<MergeOutcome>
}

const NO_GIT_HOST = 'this project has no git host package'

/** The command of the project's git host: its own package's, else a basic skill's, the basic skills' names never read from the project. */
export async function gitHostCommand(repo: string): Promise<ProvidedCommand | undefined> {
  return readProvidedCommand(repo, 'git-host', await basicGitHosts(repo).catch(() => []), await basicPackageNames()).catch(() => undefined)
}

/** The git host the project declares, run as a command. */
export const projectGitHost: GitHost = {
  async requestOfBranch(repo, branch) {
    const command = await gitHostCommand(repo)
    if (!command) return undefined
    const result = await runPackageCommand(repo, command, ['requests', '--branch', branch])
    if (!result.ok || !Array.isArray(result.output)) return undefined
    const first = result.output[0] as { number?: unknown; url?: unknown } | undefined
    return first && typeof first.number === 'number' && typeof first.url === 'string' ? { number: first.number, url: first.url } : undefined
  },

  async mergeRequest(repo, number) {
    const command = await gitHostCommand(repo)
    if (!command) return { outcome: 'failed', error: NO_GIT_HOST }
    const result = await runPackageCommand(repo, command, ['merge', String(number)])
    if (!result.ok) return { outcome: 'failed', error: result.error }
    const outcome = (result.output as { outcome?: unknown } | null)?.outcome
    return outcome === 'auto-armed' || outcome === 'merged' || outcome === 'watching' ? { outcome } : { outcome: 'failed', error: `the git host answered no outcome for pull request ${number}` }
  },
}

/**
 * The environment a run gets to work as an account at the git host (`<command> env`): the one
 * the computer's runs use, or `user`, the project's own. Nothing when the project has no git host,
 * or one that gives no environment; a `user` it cannot give is a refusal, so a run never goes on
 * as someone else than the project asked for.
 */
export async function gitHostEnv(repo: string, user?: string): Promise<{ ok: true; env: Record<string, string> } | { ok: false; error: string }> {
  const command = await gitHostCommand(repo)
  if (!command) return user !== undefined ? { ok: false, error: `${NO_GIT_HOST}, so no run can work as ${user}` } : { ok: true, env: {} }
  const result = await runPackageCommand(repo, command, ['env', ...(user !== undefined ? ['--user', user] : [])])
  if (!result.ok) return user !== undefined ? { ok: false, error: result.error } : { ok: true, env: {} }
  const env = (result.output as { env?: unknown } | null)?.env
  const given: Record<string, string> = {}
  if (env && typeof env === 'object') for (const [key, value] of Object.entries(env)) if (typeof value === 'string') given[key] = value
  return { ok: true, env: given }
}

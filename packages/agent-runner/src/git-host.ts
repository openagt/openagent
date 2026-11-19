import { runPackageCommand, type ProvidedCommand } from '@openagt/agent-data'
import { basicGitHosts } from './basic-skills.js'

/**
 * The project's git host (#1820), reached by declaration: the package among the skills its
 * distribution hands down (`basic-skills.ts`) that declares `"openagent": { "git-host": "<command>" }`
 * and answers for the project there, and this tool runs that command the way the dashboard runs
 * any provided command. The project's own packages bring none (#2394). Nothing here names a git
 * host or a package.
 *
 * What this tool asks of it: the account a run works as there. The pull request a run's branch
 * has is the github module's to read back (`@openagt/skill-github/module`).
 */

const NO_GIT_HOST = 'this project has no git host package'

/** The command of the project's git host: the first of the skills handed down whose git host answers for the project. */
export async function gitHostCommand(repo: string): Promise<ProvidedCommand | undefined> {
  const [host] = await basicGitHosts(repo).catch(() => [])
  return host
}

/**
 * The environment a run gets to work as an account at the git host (`<command> env`), and that
 * account's login: the one the computer's runs use, or `user`, the project's own. Nothing when the
 * project has no git host. One the git host cannot give is a refusal, OpenAgent having no account
 * there among them: a run never goes on as someone else, the person's own login included.
 */
export async function gitHostEnv(repo: string, user?: string): Promise<{ ok: true; env: Record<string, string>; login?: string } | { ok: false; error: string }> {
  const command = await gitHostCommand(repo)
  if (!command) return user !== undefined ? { ok: false, error: `${NO_GIT_HOST}, so no run can work as ${user}` } : { ok: true, env: {} }
  const result = await runPackageCommand(repo, command, ['env', ...(user !== undefined ? ['--user', user] : [])])
  if (!result.ok) return { ok: false, error: result.error }
  const { env, login } = (result.output ?? {}) as { env?: unknown; login?: unknown }
  const given: Record<string, string> = {}
  if (env && typeof env === 'object') for (const [key, value] of Object.entries(env)) if (typeof value === 'string') given[key] = value
  return { ok: true, env: given, ...(typeof login === 'string' && login ? { login } : {}) }
}

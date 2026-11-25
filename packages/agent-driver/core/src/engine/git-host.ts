import { sessionsHomeOf } from '@openagt/agent-data'
import { createHooks, DISTRIBUTION_ENV, loadHandedDown, type GitAccounts } from '@openagt/hooks'

/**
 * The account a run works as at the project's git host, asked before the run starts: of the
 * modules of the distribution handed down to this process ({@link DISTRIBUTION_ENV}), the one that
 * answers for the project's repository says (`account.access`' `runAs`). Nothing here names a git
 * host or a module. Inside the run, that module's own step sets the account in the run's
 * environment.
 */

/** The accounts of the distribution as read last, by the file it was read off. */
let read: { file: string; accounts: Promise<GitAccounts | undefined> } | undefined

/** The handed-down distribution's accounts, read once per distribution; none when none was handed down, or it cannot be read. */
function handedDownAccounts(env: NodeJS.ProcessEnv = process.env): Promise<GitAccounts | undefined> {
  const file = env[DISTRIBUTION_ENV] ?? ''
  if (read?.file !== file) read = { file, accounts: loadHandedDown(env).then(modules => (modules ? createHooks(modules).gitAccounts : undefined)).catch(() => undefined) }
  return read.accounts
}

/**
 * The environment a run gets to work as an account at the git host, and that account's login: the
 * one the computer's runs use, or `user`, the session's own. Nothing when no module answers for the
 * project's repository. One the module cannot give is a refusal, OpenAgent having no account there
 * among them: a run never goes on as someone else, the person's own login included.
 *
 * A session with no project, whose folder is on no host, may reach any of them (a clone, a new
 * repository, the person's pull requests): the first module that gives the account. With no
 * account named and none given, nothing, and no refusal: such a session needs no git host. One
 * named that no module gives is refused.
 */
export async function gitHostEnv(repo: string, user?: string, accounts?: GitAccounts): Promise<{ ok: true; env: Record<string, string>; login?: string } | { ok: false; error: string }> {
  const session = (await sessionsHomeOf(repo)) !== undefined
  const said = await (accounts ?? (await handedDownAccounts()))?.runAs(session ? undefined : repo, user)
  if (said?.ok) return { ok: true, env: said.env, ...(said.login ? { login: said.login } : {}) }
  if (user === undefined && (said === undefined || session)) return { ok: true, env: {} }
  return { ok: false, error: said?.error ?? `${session ? 'OpenAgent has no git host here' : 'this project has no git host'}, so no run can work as ${user}` }
}

/** Whether a module answers for the git host of the project at `repo`; a session with no project may reach one all the same. */
export async function hasGitHost(repo: string, accounts?: GitAccounts): Promise<boolean> {
  if ((await sessionsHomeOf(repo)) !== undefined) return true
  return (await (accounts ?? (await handedDownAccounts()))?.runAs(repo)) !== undefined
}

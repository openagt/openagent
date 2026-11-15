import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Refused, errorMessage } from '@openagt/agent-data'
import type { GhRunner } from './gh.js'
import { HOST, accountDir, accountsRoot, asAccount, installedAccounts, isAccountDir, picksPath, readFacts, runEnv, runsAccount, whoAmI, type AccountFacts } from './accounts.js'

/**
 * The account a command works as: one of OpenAgent's own, never the person's `gh`. Inside a run,
 * the account the run was given; elsewhere, the account runs use. With none, the command is
 * refused and says where one is added. A token kept under an account's name goes out only once
 * GitHub said it is that account's. The refusals are the command line's: only it asks.
 */

/**
 * `gh` working as one of OpenAgent's accounts: the one a run was given, when this runs inside
 * one; else the account runs use, with its token for git too, so a push `gh` makes goes as it.
 */
export async function workingGh({ gh, cwd, env }: { gh: GhRunner; cwd: string; env: NodeJS.ProcessEnv }): Promise<GhRunner> {
  const root = accountsRoot(env)
  const given = env['GH_CONFIG_DIR']
  if (given !== undefined && isAccountDir(root, given)) return asAccount(gh, given)
  const login = runsAccount(await installedAccounts(root, cwd, gh), picksPath(env))
  if (login === undefined) throw noAccount()
  const dir = accountDir(root, login)
  const working = runEnv(await tokenOf(login, dir, cwd, gh), dir, readFacts(dir), env)
  return (args, at, more, input) => gh(args, at, { ...working, ...more }, input)
}

/** One of OpenAgent's accounts: `user`, when named, else the one runs use; refused when OpenAgent has no such account. */
export async function accountNamed(user: string | undefined, cwd: string, gh: GhRunner, env: NodeJS.ProcessEnv): Promise<{ login: string; dir: string }> {
  const root = accountsRoot(env)
  const accounts = await installedAccounts(root, cwd, gh)
  if (user !== undefined && !accounts.some(a => a.login === user)) {
    throw new Refused({ ok: false, reason: 'no-account', login: user }, `OpenAgent has no GitHub account ${user} on this computer: add it in OpenAgent's Permissions`)
  }
  const login = user ?? runsAccount(accounts, picksPath(env))
  if (login === undefined) throw noAccount()
  return { login, dir: accountDir(root, login) }
}

function noAccount(): Refused {
  return new Refused({ ok: false, reason: 'no-account' }, `OpenAgent has no GitHub account: add one in OpenAgent's Permissions`)
}

/**
 * `login`'s token as OpenAgent keeps it, once GitHub said it is that account's: a login kept under
 * one name can be another account's, and nothing must go out as someone else than it says.
 */
export async function tokenOf(login: string, dir: string, cwd: string, gh: GhRunner): Promise<string> {
  let token: string
  try {
    token = (await asAccount(gh, dir)(['auth', 'token', '--hostname', HOST], cwd)).trim()
  } catch (err) {
    const detail = errorMessage(err)
    throw new Refused({ ok: false, reason: 'no-token', login, detail }, `OpenAgent has no token for ${login}: ${detail}`)
  }
  const whose = (await factsOfToken(token, cwd, gh, login)).login
  if (whose.toLowerCase() !== login.toLowerCase()) {
    throw new Refused({ ok: false, reason: 'not-that-account', login, whose }, `the login OpenAgent keeps for ${login} is ${whose}'s on GitHub: add ${login} again in OpenAgent's Permissions`)
  }
  return token
}

/** Who GitHub says a token is, asked with that token alone: no account's folder, and not the person's. `login`, when given, names the account it was asked for. */
export async function factsOfToken(token: string, cwd: string, gh: GhRunner, login?: string): Promise<AccountFacts> {
  const none = mkdtempSync(join(tmpdir(), 'openagent-gh-'))
  try {
    return await whoAmI((args, at, env, input) => asAccount(gh, none)(args, at, { ...env, GH_TOKEN: token }, input), cwd)
  } catch (err) {
    const detail = errorMessage(err)
    throw new Refused({ ok: false, reason: 'no-token', ...(login !== undefined ? { login } : {}), detail }, `GitHub did not take ${login !== undefined ? `${login}'s login` : 'the login'}: ${detail}`)
  } finally {
    rmSync(none, { recursive: true, force: true })
  }
}

import { addAccount, nameRefused, OWN_NAME, readAccounts, removeAccount } from './accounts.js'
import type { LoginWiring } from './wiring.js'
import type { AgentAccount, AgentLogins, SignInSaid } from '@openagt/hooks'

// Adding an account and taking one off: a name first, then the person signs in to the account being
// added. How is the agent's own (`RunAgent.accounts`): Claude Code makes a login that lasts a year;
// Codex keeps the account's login in a folder of its own, where it renews it.

/**
 * Log the person's own login out, with the agent's own logout: their terminal is logged out with it.
 * Why not, when it did not go through.
 */
export async function logOut(logins: AgentLogins, wiring: LoginWiring): Promise<string | undefined> {
  const given = logins.envLogins.find(name => wiring.env[name])
  if (given !== undefined) return `This login comes from ${given} in the environment: take it out of there to log out.`
  try {
    await logins.logOut(wiring.env)
  } catch (err) {
    return `The logout did not go through: ${err instanceof Error ? err.message : String(err)}`
  }
  return undefined
}

/** The name refused before the browser opens: empty, or one an account has, the person's own by the name it shows. */
export async function nameTaken(logins: AgentLogins, name: string, wiring: LoginWiring): Promise<string | undefined> {
  const accounts = readAccounts(wiring.path(logins.list))
  const own = accounts.find(a => a.login === undefined)
  const shown = own && own.name === OWN_NAME ? await logins.ownName(wiring.env) : undefined
  return nameRefused(name, shown !== undefined ? [...accounts, { name: shown }] : accounts)
}

/** Sign the account in, and keep it under `name`. Why not, when it did not go through. */
export async function signIn(logins: AgentLogins, name: string, wiring: LoginWiring, said: SignInSaid = {}): Promise<string | undefined> {
  const path = wiring.path(logins.list)
  const signed = await logins.signIn(readAccounts(path), said, wiring.env)
  if (!signed.ok) return signed.error
  try {
    addAccount(name, signed.login, path, new Date(wiring.now()))
  } catch (err) {
    // Not on the list, so nothing of it is kept beside it either.
    await logins.forget({ name, login: signed.login }, wiring.env)
    throw err
  }
  return undefined
}

/**
 * Take an added account off the list, and say which it was: none when no added account has the
 * name. What the agent keeps of it beside the list goes with it ({@link AgentLogins.forget}).
 */
export async function removeAdded(logins: AgentLogins, name: string, wiring: LoginWiring): Promise<AgentAccount | undefined> {
  const path = wiring.path(logins.list)
  const gone = readAccounts(path).find(a => a.name === name && a.login !== undefined)
  removeAccount(name, path)
  if (gone) await logins.forget(gone, wiring.env)
  return gone
}

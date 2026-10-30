import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentAccount } from '@openagt/agent-driver'
import { mintClaude, type Mint } from '@openagt/agent-driver-claude'
import { accountFolder, codexAccountsDir, codexWho, loginCodex, personalCodexHome, type CodexLogin, type CodexLoginOptions, type CodexWho } from '@openagt/agent-driver-codex'
import { accountsPath, addAccount, nameRefused, OWN_NAME, readAccounts, removeAccount, type AccountsAgent } from './accounts.js'

// Adding an account and taking one off: a name first, then the person signs in to the account being
// added. How is the agent's own: Claude Code makes a login that lasts a year; Codex keeps the
// account's login in a folder of its own, where it renews it.

/** What adding and removing reach for, swapped in tests: the logins, and where each agent keeps who the person is. */
export interface LoginWiring {
  mint: Mint
  claudeJson: () => string
  path: (agent: AccountsAgent) => string
  now: () => number
  loginCodex: (opts: CodexLoginOptions) => Promise<CodexLogin>
  codexDir: () => string
  codexOwnHome: () => string
  codexFolder: (account: AgentAccount) => string
  codexWho: (home: string) => Promise<CodexWho>
}

/** The logins of the user `env` is. */
export function loginWiring(env: NodeJS.ProcessEnv = process.env): LoginWiring {
  return {
    mint: mintClaude,
    claudeJson: () => join(env['CLAUDE_CONFIG_DIR'] ?? env['HOME'] ?? homedir(), '.claude.json'),
    path: agent => accountsPath(agent, env),
    now: Date.now,
    loginCodex,
    codexDir: () => codexAccountsDir(env),
    codexOwnHome: () => personalCodexHome(env),
    codexFolder: account => accountFolder(account, env),
    codexWho,
  }
}

/** The person's own name as Claude Code knows it: its account's display name, else its email. */
function claudeOwnName(wiring: LoginWiring): string | undefined {
  try {
    const account = (
      JSON.parse(readFileSync(wiring.claudeJson(), 'utf8')) as {
        oauthAccount?: { displayName?: unknown; emailAddress?: unknown }
      }
    ).oauthAccount
    const name = typeof account?.displayName === 'string' && account.displayName.trim() ? account.displayName.trim() : account?.emailAddress
    return typeof name === 'string' && name.trim() ? name.trim() : undefined
  } catch {
    return undefined
  }
}

/** The person's own name as the agent knows it. */
export async function ownName(agent: AccountsAgent, wiring: LoginWiring): Promise<string | undefined> {
  return agent === 'codex' ? (await wiring.codexWho(wiring.codexOwnHome())).name : claudeOwnName(wiring)
}

/** The name refused before the browser opens: empty, or one an account has, the person's own by the name it shows. */
export async function nameTaken(agent: AccountsAgent, name: string, wiring: LoginWiring): Promise<string | undefined> {
  const accounts = readAccounts(wiring.path(agent))
  const own = accounts.find(a => a.login === undefined)
  const shown = own && own.name === OWN_NAME ? await ownName(agent, wiring) : undefined
  return nameRefused(name, shown !== undefined ? [...accounts, { name: shown }] : accounts)
}

/** Who each Codex account already on the list is: a new one that is one of them is refused. */
async function codexKeys(wiring: LoginWiring): Promise<string[]> {
  const homes = readAccounts(wiring.path('codex')).map(a => (a.login === undefined ? wiring.codexOwnHome() : wiring.codexFolder(a)))
  const keys = await Promise.all(homes.map(home => wiring.codexWho(home).then(who => who.key)))
  return keys.filter((key): key is string => key !== undefined)
}

/** How the person is told where to sign in. Unsaid, this computer's browser opens and that is all. */
export interface SignInSaid {
  /** Claude's page, on a computer with no browser: its code is pasted back through `paste`. */
  onLink?: (url: string, paste: (code: string) => boolean) => void
  /** Codex's page, as the browser opens on it: what a person copies into a private window. */
  onUrl?: (url: string) => void
  /** Codex's code, on a computer with no browser: the person types it at `url`. */
  onCode?: (code: string, url: string) => void
}

/** Sign the account in, and keep it under `name`. Why not, when it did not go through. */
export async function signIn(agent: AccountsAgent, name: string, wiring: LoginWiring, said: SignInSaid = {}): Promise<string | undefined> {
  const path = wiring.path(agent)
  if (agent === 'claude') {
    const minted = await wiring.mint(said.onLink ? { onLink: said.onLink } : {})
    if (!minted.ok) return minted.error
    addAccount(name, minted.login, path, new Date(wiring.now()))
    return undefined
  }
  const signed = await wiring.loginCodex({ dir: wiring.codexDir(), ...(said.onCode ? { onCode: said.onCode } : {}), ...(said.onUrl ? { onUrl: said.onUrl } : {}) })
  if (!signed.ok) return signed.error
  const folder = join(wiring.codexDir(), signed.login)
  // The browser may have been signed in to an account on the list already: that one is not added twice.
  if (signed.who.key !== undefined && (await codexKeys(wiring)).includes(signed.who.key)) {
    await rm(folder, { recursive: true, force: true })
    return 'That account is on the list already. If the browser was signed in to it, copy the link into a private window and sign in to the other account there.'
  }
  try {
    addAccount(name, signed.login, path, new Date(wiring.now()))
  } catch (err) {
    await rm(folder, { recursive: true, force: true })
    throw err
  }
  return undefined
}

/**
 * Take an added account off the list, and say which it was: none when no added account has the name.
 * A Claude login is not ended: it is good until its year is over, or until it is taken back on
 * claude.ai. A Codex account's folder, its login in it, goes with it.
 */
export async function removeAdded(agent: AccountsAgent, name: string, wiring: LoginWiring): Promise<AgentAccount | undefined> {
  const gone = readAccounts(wiring.path(agent)).find(a => a.name === name && a.login !== undefined)
  removeAccount(name, wiring.path(agent))
  if (gone && agent === 'codex') await rm(wiring.codexFolder(gone), { recursive: true, force: true })
  return gone
}

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentAccount } from '@openagt/hooks'

// The Claude accounts runs may use (`@openagt/agent-driver` keeps the list): the person's own
// login, which Claude Code keeps (the Mac's Keychain, else its own login file), and the ones added
// beside it, each a whole login of Claude Code's own in a folder of OpenAgent's
// (`CLAUDE_CONFIG_DIR`), signed in with `claude auth login` (his pick, 2026-11-25: such a login
// says how full it is, `/usage`, as a login made for a computer nobody sits at does not). A turn on
// an added account runs with that folder for Claude Code's own, linked to the person's
// conversations and setup, so a conversation one account started the next goes on with: the
// person's terminal never changes account.

/** The name Claude Code reads a login under that was made for a computer nobody sits at. */
export const CLAUDE_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'

/** The logins Claude Code takes from its environment before its own. */
export const CLAUDE_ENV_LOGINS = [CLAUDE_TOKEN_ENV, 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

/** The folder added accounts are kept in, one folder each: `$XDG_STATE_HOME/agent-driver/claude-accounts`, or under `~/.local/state`. */
export function claudeAccountsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['XDG_STATE_HOME'] || join(env['HOME'] || homedir(), '.local', 'state'), 'agent-driver', 'claude-accounts')
}

/** What names an added account's folder: what this package made it with, never a login of another kind. */
const FOLDER_LOGIN = /^acct-[0-9a-f]{16}$/

/** Whether `account` is one added here with a folder of its own (an account added before, as a login for a computer nobody sits at, is not). */
export function isFolderAccount(account: AgentAccount): boolean {
  return account.login !== undefined && FOLDER_LOGIN.test(account.login)
}

/** An added account's folder, where Claude Code keeps its login: the list names it by {@link AgentAccount.login}. */
export function accountFolder(account: AgentAccount, env: NodeJS.ProcessEnv = process.env): string {
  if (!isFolderAccount(account)) throw new Error(`${account.name} has no Claude login on this computer: sign in to it again`)
  return join(claudeAccountsDir(env), account.login!)
}

/** The folder Claude Code keeps the person's own setup and conversations in: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function personalClaudeDir(env: NodeJS.ProcessEnv): string {
  return env['CLAUDE_CONFIG_DIR'] || join(env['HOME'] || homedir(), '.claude')
}

/** What an added account's folder shares with the person's: their conversations, always; their setup, which the run's switches load or leave as for any account. */
const SHARED = ['projects', 'settings.json', 'CLAUDE.md', 'agents', 'commands', 'skills', 'plugins', 'output-styles', 'hooks']

/**
 * Link what `folder` shares with the person's own Claude folder ({@link SHARED}), where they have
 * it: a conversation goes on whichever account takes the turn, and the person's setup is theirs on
 * every account. Never their `.claude.json`, which holds who their login is.
 */
export function linkShared(folder: string, personal: string): void {
  // Made when missing, as Claude Code makes it on a first run, so every account's conversations end up in one place.
  mkdirSync(join(personal, 'projects'), { recursive: true })
  for (const name of SHARED) {
    const target = join(personal, name)
    if (!existsSync(target)) continue
    const link = join(folder, name)
    let found: ReturnType<typeof lstatSync> | undefined
    try {
      found = lstatSync(link)
    } catch {
      found = undefined
    }
    if (found?.isSymbolicLink() && readlinkSync(link) === target) continue
    // Something of Claude Code's own in its place is never thrown away.
    if (found && !found.isSymbolicLink()) continue
    if (found) rmSync(link, { force: true })
    try {
      symlinkSync(target, link)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}

/** `env` with `folder` for Claude Code's own: the login it keeps there, and none of a login handed in beside it. */
export function folderEnv(folder: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const rest = Object.fromEntries(Object.entries(env).filter(([name]) => !(CLAUDE_ENV_LOGINS as readonly string[]).includes(name)))
  return { ...rest, CLAUDE_CONFIG_DIR: folder }
}

/** The environment a turn on `account` runs with: an added account's folder, linked to the person's own; the person's own login as `env` has it. */
export function accountEnv(account: AgentAccount, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (account.login === undefined) return env
  const folder = accountFolder(account, env)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  linkShared(folder, personalClaudeDir(env))
  return folderEnv(folder, env)
}

/** Who the login kept in a Claude folder is, as Claude Code keeps it after a sign-in; none when it keeps none. */
export function folderAccountId(folder: string): string | undefined {
  try {
    const id = (JSON.parse(readFileSync(join(folder, '.claude.json'), 'utf8')) as { oauthAccount?: { accountUuid?: unknown } }).oauthAccount?.accountUuid
    return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * Who the person's own Claude login on this computer is, as Claude Code keeps it after a browser
 * login: what a login this computer makes for another goes with. Nothing when it is logged in to
 * no account, or keeps no id.
 */
export function claudeAccountHere(env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    const kept = JSON.parse(readFileSync(join(env['CLAUDE_CONFIG_DIR'] ?? env['HOME'] ?? homedir(), '.claude.json'), 'utf8')) as { oauthAccount?: { accountUuid?: unknown } }
    const id = kept.oauthAccount?.accountUuid
    return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined
  } catch {
    return undefined
  }
}

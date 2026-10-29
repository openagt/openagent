import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { accountsPath, type AgentAccount } from '@openagt/agent-driver'

// The Claude accounts runs may use (`accounts.ts` in the driver core keeps the list): the person's
// own login, which Claude Code keeps (the Mac's Keychain, a server's login file), and the ones added
// beside it, each a login Claude Code made for a computer nobody sits at (`claude setup-token`). A
// turn on an added account has its login in the turn's environment alone, where Claude Code reads
// it before its own: the person's terminal never changes account.

/** The name Claude Code reads a login under that was made for a computer nobody sits at. */
export const CLAUDE_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'

/**
 * The name Claude Code reads who such a login is under. The login cannot say it itself, and
 * without it Claude Code offers only its four plain models, not the ones the account may use.
 */
export const CLAUDE_ACCOUNT_ENV = 'CLAUDE_CODE_ACCOUNT_UUID'

/** Where the Claude accounts are kept: `$XDG_CONFIG_HOME/openagent-claude-accounts.json`, else dotted under the home. */
export function claudeAccountsPath(env: NodeJS.ProcessEnv = process.env): string {
  return accountsPath('claude', env)
}

/** The environment a turn on `account` runs with: an added account's login in it, and who it is when known; the person's own as Claude Code keeps it. */
export function accountEnv(account: AgentAccount, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (account.login === undefined) return env
  const { [CLAUDE_ACCOUNT_ENV]: _other, ...rest } = env
  return { ...rest, [CLAUDE_TOKEN_ENV]: account.login, ...(account.accountId !== undefined ? { [CLAUDE_ACCOUNT_ENV]: account.accountId } : {}) }
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

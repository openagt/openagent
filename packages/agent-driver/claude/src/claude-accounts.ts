import { accountsPath, type AgentAccount } from '@openagt/agent-driver'

// The Claude accounts runs may use (`accounts.ts` in the driver core keeps the list): the person's
// own login, which Claude Code keeps (the Mac's Keychain, a server's login file), and the ones added
// beside it, each a login Claude Code made for a computer nobody sits at (`claude setup-token`). A
// turn on an added account has its login in the turn's environment alone, where Claude Code reads
// it before its own: the person's terminal never changes account.

/** The name Claude Code reads a login under that was made for a computer nobody sits at. */
export const CLAUDE_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'

/** Where the Claude accounts are kept: `$XDG_CONFIG_HOME/openagent-claude-accounts.json`, else dotted under the home. */
export function claudeAccountsPath(env: NodeJS.ProcessEnv = process.env): string {
  return accountsPath('claude', env)
}

/** The environment a turn on `account` runs with: an added account's login in it, the person's own as Claude Code keeps it. */
export function accountEnv(account: AgentAccount, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return account.login !== undefined ? { ...env, [CLAUDE_TOKEN_ENV]: account.login } : env
}

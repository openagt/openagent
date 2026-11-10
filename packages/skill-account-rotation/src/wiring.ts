import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentAccount, DriverQuota, DriverRateWindow } from '@openagt/agent-driver'
import { ClaudeCodeDriver, mintClaude, type Mint } from '@openagt/agent-driver-claude'
import { accountFolder, codexAccountsDir, codexWho, loginCodex, personalCodexHome, readCodexUsage, type CodexLogin, type CodexLoginOptions, type CodexWho } from '@openagt/agent-driver-codex'
import { accountsPath, type AccountsAgent } from './accounts.js'
import { addingPath, startAddingProcess } from './adding.js'
import { claudeUsagePath } from './usage.js'

// Everything adding, removing and reading the accounts reach for beyond the list itself, in one
// place: the agents' own logins and sign-ins, where each keeps who the person is, the files beside
// the accounts, and the processes a sign-in runs in. The modules that use it take it as a value,
// so a test hands them its own; only this one knows the real ones.

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
  /** The environment an agent's own login may be given in. */
  env: NodeJS.ProcessEnv
  /** Where the person's own Claude login's reading is kept. */
  claudeUsagePath: () => string
  /** Claude Code's `/usage`, of the person's own login. */
  claudeQuota: () => Promise<DriverQuota>
  /** How full the Codex login in a home is, now. */
  codexUsage: (home: string) => Promise<DriverRateWindow[]>
  /** No browser on this computer: a server's. The person signs in on another device. */
  headless: () => boolean
  /** Where an agent's sign-in says how it goes. */
  addingPath: (agent: AccountsAgent) => string
  /** Start an agent's sign-in, on its own: what the sign-in itself runs is `signIn` (`login.ts`). */
  startAdding: (agent: AccountsAgent, name: string) => void
  /** This process, as a sign-in says it runs in it. */
  ownPid: () => number
  /** Whether a sign-in's process is still there. */
  isRunning: (pid: number) => boolean
  /** Stop a sign-in's process. */
  stopAdding: (pid: number) => void
  /** Run the agent's own logout, of the person's own login. */
  logOutAgent: (agent: AccountsAgent) => Promise<void>
}

/** The agents' own logouts. */
const LOG_OUT: Record<AccountsAgent, readonly [string, ...string[]]> = { claude: ['claude', 'auth', 'logout'], codex: ['codex', 'logout'] }
/** How long an agent's logout gets: a page's call ends at 30 seconds. */
const LOG_OUT_MS = 25_000

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
    env,
    claudeUsagePath: () => claudeUsagePath(env),
    claudeQuota: () => new ClaudeCodeDriver().readQuota(),
    codexUsage: home => readCodexUsage({ home }),
    headless: () => env['OPENAGENT_SERVER'] === '1',
    addingPath: agent => addingPath(agent, env),
    startAdding: startAddingProcess,
    ownPid: () => process.pid,
    isRunning: pid => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    stopAdding: pid => {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // Gone already.
      }
    },
    logOutAgent: agent =>
      new Promise((resolve, reject) => {
        const [bin, ...args] = LOG_OUT[agent]
        execFile(bin, args, { env, timeout: LOG_OUT_MS }, err => (err ? reject(err) : resolve()))
      }),
  }
}

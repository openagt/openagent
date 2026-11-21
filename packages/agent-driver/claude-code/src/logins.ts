import { execFile } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { probeCli } from '@openagt/agent-driver'
import type { AgentLogins, DriverQuota, UsageWindow } from '@openagt/hooks'
import { CLAUDE_ENV_LOGINS } from './claude-accounts.js'
import { ClaudeCodeDriver } from './claude-code.js'
import { claudeUsagePath, keptClaudeReading } from './claude-code-quota.js'
import { isSignInCode, mintClaude, type Mint } from './claude-login.js'

// Claude Code's accounts (`RunAgent.accounts`, the list `claude`): the person's own login, which
// Claude Code keeps, and the ones added beside it, each a login Claude Code makes for a computer
// nobody sits at (`claude setup-token`), good for a year. Taking one off the list ends nothing: it
// is good until its year is over, or until it is taken back on claude.ai.
//
// How full the person's own login is, Claude Code says through `/usage`, and it refuses `/usage`
// when asked too often, for minutes, whoever asks: every tab of a card and OpenAgent's own poller
// count against one login. So the reading the reader keeps for everyone on this computer
// (`readClaudeQuota`) serves the cards for longer than OpenAgent's poller waits between its own
// reads. A failed reading serves nobody: it may say more of the process that took it (a sandbox
// with no credentials) than of the login. An added login says how full it is only in its runs.

/** How long a reading of `/usage` serves everyone on this computer: a little over the five minutes OpenAgent's poller waits. */
export const READING_KEPT_MS = 6 * 60_000

/** How long Claude Code's logout gets: a page's call ends at 30 seconds. */
const LOG_OUT_MS = 25_000

/** A `/usage` reading in the names a turn's own windows go by; none for one that said nothing. */
function readingWindows(quota: DriverQuota): UsageWindow[] | undefined {
  if (!quota.available) return undefined
  const named = { session: 'five_hour', week: 'seven_day' } as const
  const windows = quota.windows.flatMap((window): UsageWindow[] => {
    const name = window.kind === 'session' || window.kind === 'week' ? named[window.kind] : undefined
    return name ? [{ window: name, percentUsed: window.percentUsed, ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}) }] : []
  })
  return windows.length > 0 ? windows : undefined
}

/** The person's own name as Claude Code knows it: its account's display name, else its email. */
function ownNameIn(env: NodeJS.ProcessEnv): string | undefined {
  try {
    const account = (
      JSON.parse(readFileSync(join(env['CLAUDE_CONFIG_DIR'] ?? env['HOME'] ?? homedir(), '.claude.json'), 'utf8')) as {
        oauthAccount?: { displayName?: unknown; emailAddress?: unknown }
      }
    ).oauthAccount
    const name = typeof account?.displayName === 'string' && account.displayName.trim() ? account.displayName.trim() : account?.emailAddress
    return typeof name === 'string' && name.trim() ? name.trim() : undefined
  } catch {
    return undefined
  }
}

/** What Claude Code's accounts reach for, swapped in tests: never the real `claude`, which would log this computer's person out. */
export interface ClaudeLoginsDeps {
  /** How a login is made. Claude Code's own `claude setup-token` when unsaid. */
  mint?: Mint
  /** Claude Code's `/usage`, of the person's own login. */
  quota?: () => Promise<DriverQuota>
  /** The clock a kept reading is told old by. */
  now?: () => number
}

/** Claude Code's accounts on this computer. */
export function claudeLogins(deps: ClaudeLoginsDeps = {}): AgentLogins {
  const mint = deps.mint ?? mintClaude
  const quota = deps.quota ?? (() => new ClaudeCodeDriver().readQuota())
  const now = deps.now ?? Date.now
  const ownLoginThere = (env: NodeJS.ProcessEnv): boolean => CLAUDE_ENV_LOGINS.some(name => env[name]) || ownNameIn(env) !== undefined
  return {
    list: 'claude',
    service: 'Claude',
    envLogins: CLAUDE_ENV_LOGINS,
    installed: async () => (await probeCli('claude', ['--version'])).ok,
    ownLoginThere,
    ownName: env => Promise.resolve(ownNameIn(env)),
    async logOut(env) {
      await new Promise<void>((resolve, reject) => execFile('claude', ['auth', 'logout'], { env, timeout: LOG_OUT_MS }, err => (err ? reject(err) : resolve())))
      // What was read of the login is not the next one's.
      rmSync(claudeUsagePath(env), { force: true })
    },
    signIn: (_accounts, said) => mint({ ...(said.onLink ? { onLink: said.onLink } : {}), ...(said.onRefused ? { onRefused: said.onRefused } : {}), ...(said.signal ? { signal: said.signal } : {}) }),
    isSignInCode,
    // An added login stays good until its year is over: nothing of it is kept beside the list.
    forget: () => Promise.resolve(),
    async usage(account, env) {
      if (account.login !== undefined) return undefined
      const kept = keptClaudeReading(claudeUsagePath(env), now(), READING_KEPT_MS)
      if (kept) return readingWindows(kept)
      if (!ownLoginThere(env)) return undefined
      const read = await quota().catch(() => undefined)
      return read ? readingWindows(read) : undefined
    },
  }
}

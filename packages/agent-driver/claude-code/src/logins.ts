import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { probeCli } from '@openagt/agent-driver'
import type { AgentAccount, AgentLogins, DriverQuota, UsageWindow } from '@openagt/hooks'
import { accountFolder, CLAUDE_ENV_LOGINS, claudeAccountHere, claudeAccountsDir, folderAccountId, folderEnv, isFolderAccount, linkShared, personalClaudeDir } from './claude-accounts.js'
import { ClaudeCodeDriver } from './claude-code.js'
import { claudeUsagePath, keptClaudeReading, readClaudeQuota } from './claude-code-quota.js'
import { isSignInCode, mintClaude, type Mint } from './claude-login.js'

// Claude Code's accounts (`RunAgent.accounts`, the list `claude`): the person's own login, which
// Claude Code keeps, and the ones added beside it, each a whole login of Claude Code's own in a
// folder of its own (`claude auth login`, `claude-accounts.ts`), which Claude Code renews as it
// uses it. Taking one off the list logs it out there and takes its folder away. One whose login
// is gone is said signed out: signed in to again, it keeps its place on the list.
//
// How full a login is, Claude Code says through `/usage`, and it refuses `/usage` when asked too
// often, for minutes, whoever asks: every tab of a card and OpenAgent's own poller count against
// one login. So the reading kept for everyone on this computer (`readClaudeQuota`) serves the
// cards for longer than OpenAgent's poller waits between its own reads; an added account's is
// kept in its folder. A failed reading serves nobody: it may say more of the process that took it
// (a sandbox with no credentials) than of the login.

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
  /** How a sign-in is run. Claude Code's own (`claude auth login`, in the account's folder) when unsaid. */
  mint?: Mint
  /** Claude Code's `/usage`, of the person's own login. */
  quota?: () => Promise<DriverQuota>
  /** Claude Code's `/usage` with `env`, its reading kept in `keptIn`: an added account's. */
  quotaIn?: (env: NodeJS.ProcessEnv, keptIn: string) => Promise<DriverQuota>
  /** Claude Code's own logout with `env`: an added account's, as it is taken off the list. */
  logOutIn?: (env: NodeJS.ProcessEnv) => Promise<void>
  /** The clock a kept reading is told old by. */
  now?: () => number
}

/** Where an added account's `/usage` reading is kept: in its folder, with its login. */
const USAGE_FILE = 'openagent-usage.json'

/** A folder's names; none when it is not there. */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Claude Code's own logout with `env`. */
function claudeLogOut(env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise<void>((resolve, reject) => execFile('claude', ['auth', 'logout'], { env, timeout: LOG_OUT_MS }, err => (err ? reject(err) : resolve())))
}

/** Claude Code's accounts on this computer. */
export function claudeLogins(deps: ClaudeLoginsDeps = {}): AgentLogins {
  const mint = deps.mint ?? mintClaude
  const quota = deps.quota ?? (() => new ClaudeCodeDriver().readQuota())
  const quotaIn = deps.quotaIn ?? ((env, keptIn) => readClaudeQuota({ env, keptIn }))
  const logOutIn = deps.logOutIn ?? claudeLogOut
  const now = deps.now ?? Date.now
  /** Whether an added account's folder keeps a login: none for one signed out, nor for one with no folder here. */
  const addedLoginThere = (account: AgentAccount, env: NodeJS.ProcessEnv): boolean => isFolderAccount(account) && folderAccountId(accountFolder(account, env)) !== undefined
  const ownLoginThere = (env: NodeJS.ProcessEnv): boolean => CLAUDE_ENV_LOGINS.some(name => env[name]) || ownNameIn(env) !== undefined
  return {
    list: 'claude',
    service: 'Claude',
    envLogins: CLAUDE_ENV_LOGINS,
    installed: async () => (await probeCli('claude', ['--version'])).ok,
    ownLoginThere,
    ownName: env => Promise.resolve(ownNameIn(env)),
    async logOut(env) {
      await claudeLogOut(env)
      // What was read of the login is not the next one's.
      rmSync(claudeUsagePath(env), { force: true })
    },
    addedLoginThere,
    async signIn(accounts, said, env) {
      // A folder no account on the list names is a sign-in's that never ended its own way (its process
      // stopped as it was cancelled): logged out there and taken away before the next one begins.
      const named = new Set(accounts.flatMap(account => (account.login !== undefined ? [account.login] : [])))
      for (const left of readdirSafe(claudeAccountsDir(env)).filter(name => !named.has(name))) {
        const leftover = join(claudeAccountsDir(env), left)
        if (folderAccountId(leftover) !== undefined) await logOutIn(folderEnv(leftover, env)).catch(() => {})
        rmSync(leftover, { recursive: true, force: true })
      }
      // A folder of its own, the login signed in there with Claude Code's own sign-in in this computer's browser.
      const login = `acct-${randomBytes(8).toString('hex')}`
      const folder = join(claudeAccountsDir(env), login)
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      // The person's parts linked in before Claude Code first starts there: it makes its own of what it finds missing, which a link never replaces.
      linkShared(folder, personalClaudeDir(env))
      const signed = await mint({
        command: 'claude auth login',
        // Blank, over this process's own: a login handed in to OpenAgent is not the one signed in here.
        env: { ...folderEnv(folder, {}), ...Object.fromEntries(CLAUDE_ENV_LOGINS.map(name => [name, ''])) },
        kept: async () => (folderAccountId(folder) !== undefined ? login : undefined),
        ...(said.onLink ? { onLink: said.onLink } : {}),
        ...(said.onRefused ? { onRefused: said.onRefused } : {}),
        ...(said.signal ? { signal: said.signal } : {}),
      })
      const gone = async (error: string) => {
        await logOutIn(folderEnv(folder, env)).catch(() => {})
        rmSync(folder, { recursive: true, force: true })
        return { ok: false as const, error }
      }
      if (!signed.ok) return gone(signed.error)
      // The browser may have been signed in to an account on the list already, the person's own among them: that one is not added twice.
      const id = folderAccountId(folder)
      const known = [claudeAccountHere(env), ...accounts.filter(isFolderAccount).map(account => folderAccountId(accountFolder(account, env)))]
      if (id !== undefined && known.includes(id)) return gone('That account is on the list already. If the browser was signed in to it, copy the link into a private window and sign in to the other account there.')
      return { ok: true, login }
    },
    isSignInCode,
    // Logged out there, so Claude Code keeps nothing of it on this computer, and its folder taken away.
    async forget(account, env) {
      if (!isFolderAccount(account)) return
      const folder = accountFolder(account, env)
      if (!existsSync(folder)) return
      await logOutIn(folderEnv(folder, env)).catch(() => {})
      rmSync(folder, { recursive: true, force: true })
    },
    async usage(account, env) {
      if (account.login !== undefined) {
        if (!addedLoginThere(account, env)) return undefined
        const folder = accountFolder(account, env)
        // Read with Claude Code started there: the person's parts linked in first, as for a turn.
        linkShared(folder, personalClaudeDir(env))
        const keptIn = join(folder, USAGE_FILE)
        const kept = keptClaudeReading(keptIn, now(), READING_KEPT_MS)
        if (kept) return readingWindows(kept)
        const read = await quotaIn(folderEnv(folder, env), keptIn).catch(() => undefined)
        return read ? readingWindows(read) : undefined
      }
      const kept = keptClaudeReading(claudeUsagePath(env), now(), READING_KEPT_MS)
      if (kept) return readingWindows(kept)
      if (!ownLoginThere(env)) return undefined
      const read = await quota().catch(() => undefined)
      return read ? readingWindows(read) : undefined
    },
  }
}

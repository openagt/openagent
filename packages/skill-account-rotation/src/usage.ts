import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentAccount, DriverQuota, DriverRateWindow } from '@openagt/agent-driver'
import { readAccounts, type AccountsAgent } from './accounts.js'
import { ownLoginThere, type LoginWiring } from './login.js'

// How full each account is, now where it can be known. The person's own Claude login says so
// through Claude Code's `/usage`, every Codex login through Codex; an added Claude login only in
// its runs, so it says what its last run saw.
//
// Claude refuses `/usage` when asked too often, for minutes, whoever asks: every tab of a card and
// OpenAgent's own poller count against one login. So a good reading is kept in one file for all of
// them, for longer than OpenAgent's poller waits between its own reads: with OpenAgent running, this
// command never has to ask. A failed reading is not kept: it may say more of the process that took
// it (a sandbox with no credentials) than of the login.

/** How long a reading of `/usage` serves everyone on this computer: a little over the five minutes OpenAgent's poller waits. */
export const READING_KEPT_MS = 6 * 60_000

/** One window of an account: its name, how full, and when it resets where that is known exactly. */
export interface UsageWindow {
  window: string
  percentUsed: number
  resetsAt?: number
}

/** How full one account is, as `usage` answers: its windows shortest first. `at` when this is what its last run saw rather than a reading now. */
export interface AccountUsage {
  name: string
  windows: UsageWindow[]
  at?: number
}

/** A reading kept in the file. */
interface KeptReading {
  at: number
  windows: UsageWindow[]
}

/** The file: `$XDG_CONFIG_HOME/openagent-claude-usage.json`, else dotted under the home. */
export function claudeUsagePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env['XDG_CONFIG_HOME']) return join(env['XDG_CONFIG_HOME'], 'openagent-claude-usage.json')
  return join(env['HOME'] ?? homedir(), '.openagent-claude-usage.json')
}

/** A `/usage` reading in the names a turn's own windows go by; undefined for one that said nothing. */
function readingWindows(quota: DriverQuota): UsageWindow[] | undefined {
  if (!quota.available) return undefined
  const named = { session: 'five_hour', week: 'seven_day' } as const
  const windows = quota.windows.flatMap((window): UsageWindow[] => {
    const name = window.kind === 'session' || window.kind === 'week' ? named[window.kind] : undefined
    return name ? [{ window: name, percentUsed: window.percentUsed, ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}) }] : []
  })
  return windows.length > 0 ? windows : undefined
}

/**
 * Keep a good reading of `/usage` for everyone on this computer: written whole, then moved over the
 * old one. A failed one changes nothing, and neither does a file that cannot be written: the
 * reading is still good, and the next one who asks only asks again.
 */
export function keepClaudeReading(quota: DriverQuota, path: string = claudeUsagePath(), now: number = Date.now()): void {
  const windows = readingWindows(quota)
  if (!windows) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    const next = `${path}.${process.pid}.new`
    writeFileSync(next, `${JSON.stringify({ at: now, windows } satisfies KeptReading)}\n`, { mode: 0o600 })
    renameSync(next, path)
  } catch {
    // Read again next time.
  }
}

/** The kept reading while it serves; undefined when there is none, it is too old, or it says a time to come. */
function keptReading(path: string, now: number): UsageWindow[] | undefined {
  try {
    const kept = JSON.parse(readFileSync(path, 'utf8')) as Partial<KeptReading>
    if (typeof kept.at !== 'number' || !Array.isArray(kept.windows)) return undefined
    return now >= kept.at && now - kept.at < READING_KEPT_MS ? kept.windows : undefined
  } catch {
    return undefined
  }
}

/** The person's own Claude login now: the kept reading, else `/usage`. Undefined with no login to ask about, or when it does not answer. */
async function ownClaudeReading(wiring: LoginWiring): Promise<UsageWindow[] | undefined> {
  const now = wiring.now()
  const kept = keptReading(wiring.claudeUsagePath(), now)
  if (kept) return kept
  if (!ownLoginThere('claude', wiring)) return undefined
  const quota = await wiring.claudeQuota().catch(() => undefined)
  if (!quota) return undefined
  keepClaudeReading(quota, wiring.claudeUsagePath(), now)
  return readingWindows(quota)
}

/** A Codex login now. Undefined with no login in its home, or when it does not answer. */
async function codexReading(home: string, wiring: LoginWiring): Promise<UsageWindow[] | undefined> {
  const who = await wiring.codexWho(home)
  if (who.key === undefined && who.name === undefined) return undefined
  return wiring.codexUsage(home).catch(() => undefined)
}

/** The windows a person reads, shortest first; one gone past its reset is empty again. */
function shown(windows: readonly (UsageWindow | DriverRateWindow)[], now: number): UsageWindow[] {
  const order = ['five_hour', 'seven_day', 'thirty_day']
  return windows
    .filter(window => order.includes(window.window))
    .map(window => (window.resetsAt !== undefined && window.resetsAt <= now ? { ...window, percentUsed: 0 } : window))
    .sort((a, b) => order.indexOf(a.window) - order.indexOf(b.window))
}

async function accountUsage(agent: AccountsAgent, account: AgentAccount, wiring: LoginWiring): Promise<AccountUsage> {
  const own = account.login === undefined
  const live = agent === 'codex' ? await codexReading(own ? wiring.codexOwnHome() : wiring.codexFolder(account), wiring) : own ? await ownClaudeReading(wiring) : undefined
  const now = wiring.now()
  if (live) return { name: account.name, windows: shown(live, now) }
  return { name: account.name, windows: shown(account.windows ?? [], now), ...(account.windowsAt !== undefined ? { at: account.windowsAt } : {}) }
}

/** How full each account of each agent is, in the order runs try them. */
export async function readUsage(wiring: LoginWiring): Promise<Record<AccountsAgent, AccountUsage[]>> {
  const of = (agent: AccountsAgent): Promise<AccountUsage[]> => Promise.all(readAccounts(wiring.path(agent)).map(account => accountUsage(agent, account, wiring)))
  const [claude, codex] = await Promise.all([of('claude'), of('codex')])
  return { claude, codex }
}

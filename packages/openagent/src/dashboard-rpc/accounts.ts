import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeAccountsPath, mintClaude, type Mint } from '@openagt/agent-driver-claude'
import { addAccount, isLimited, nameOwnAccount, OWN_NAME, readAccounts, removeAccount, useFirst, type AgentAccount } from '@openagt/agent-driver'
import type { DriverQuotaWindow, DriverRateWindow } from '@openagt/agent-driver'
import { contextQuota } from './context.js'

// The Claude accounts runs use (`claude-accounts.ts` in the Claude driver): the person's own login,
// which Claude Code keeps, and the ones added beside it. A page sees each one's name, how full it
// is and whether a limit keeps it out, never a login. Adding one asks the person in this
// computer's browser, as a server's Claude login does: Claude Code makes a login that lasts a year.

/** One account as the page shows it. */
export interface AccountRow {
  /** The account as the file names it: what the page sends back to act on it. */
  id: string
  /** Its name as shown: the person's own goes by Claude Code's name for them until they give it one. */
  name: string
  /** The person's own login, which Claude Code keeps: it is never removed. */
  own: boolean
  /** When an added one was added, ISO 8601. */
  added?: string
  /** How much of the week is gone, 0-100; none when nothing said it yet. */
  weekPercent?: number
  /** How much of the 5-hour window is gone, 0-100. */
  sessionPercent?: number
  /** When those were said, epoch ms: an added account is known from its last run. None for a reading taken now. */
  asOf?: number
  /** Until when a limit keeps it out, epoch ms. */
  limitedUntil?: number
  /** `in-use`: the first one a run takes now; `next`: the one after it; `limited`: a limit keeps it out. */
  state?: 'in-use' | 'next' | 'limited'
}

/** An account being added: the browser is open on Claude's page, or the login it made is being kept. */
export interface AccountAdding {
  name: string
}

export interface AccountsView {
  accounts: AccountRow[]
  adding?: AccountAdding
  /** Why the last add did not go through. */
  failed?: string
  /** The daemon's clock, so "free in 2 h" is counted from the same now. */
  now: number
}

/** What the RPCs reach for, swapped in tests: the login maker and where Claude Code keeps who the person is. */
export const accountsWiring: {
  mint: Mint
  claudeJson: () => string
  path: () => string
  now: () => number
} = {
  mint: mintClaude,
  claudeJson: () => join(process.env['CLAUDE_CONFIG_DIR'] ?? process.env['HOME'] ?? homedir(), '.claude.json'),
  path: () => claudeAccountsPath(process.env),
  now: Date.now,
}

let adding: AccountAdding | undefined
let failed: string | undefined

/** The person's own name as Claude Code knows it: its account's display name, else its email. */
function ownName(): string | undefined {
  try {
    const account = (
      JSON.parse(readFileSync(accountsWiring.claudeJson(), 'utf8')) as {
        oauthAccount?: { displayName?: unknown; emailAddress?: unknown }
      }
    ).oauthAccount
    const name = typeof account?.displayName === 'string' && account.displayName.trim() ? account.displayName.trim() : account?.emailAddress
    return typeof name === 'string' && name.trim() ? name.trim() : undefined
  } catch {
    return undefined
  }
}

/** A window gone past its reset is empty again, whatever the last run said of it. */
function percentOf(windows: DriverRateWindow[] | undefined, name: string, now: number): number | undefined {
  const window = windows?.find(w => w.window === name)
  if (window === undefined) return undefined
  return window.resetsAt <= now ? 0 : window.percentUsed
}

function liveWeek(windows: DriverQuotaWindow[]): {
  weekPercent?: number
  sessionPercent?: number
} {
  const week = windows.find(w => w.kind === 'week')
  const session = windows.find(w => w.kind === 'session')
  return {
    ...(week ? { weekPercent: week.percentUsed } : {}),
    ...(session ? { sessionPercent: session.percentUsed } : {}),
  }
}

function row(account: AgentAccount, live: DriverQuotaWindow[], now: number): AccountRow {
  const own = account.login === undefined
  const name = own && account.name === OWN_NAME ? (ownName() ?? OWN_NAME) : account.name
  // The person's own login is read live where Claude Code lets it be (`/usage`); else, as an added one, from its last run.
  const reading =
    own && live.length > 0
      ? liveWeek(live)
      : {
          ...(percentOf(account.windows, 'seven_day', now) !== undefined ? { weekPercent: percentOf(account.windows, 'seven_day', now)! } : {}),
          ...(percentOf(account.windows, 'five_hour', now) !== undefined ? { sessionPercent: percentOf(account.windows, 'five_hour', now)! } : {}),
          ...(account.windowsAt !== undefined ? { asOf: account.windowsAt } : {}),
        }
  return {
    id: account.name,
    name,
    own,
    ...(account.added !== undefined ? { added: account.added } : {}),
    ...reading,
    ...(isLimited(account, now) ? { limitedUntil: account.limitedUntil! } : {}),
  }
}

/** The accounts in the order runs try them, each with how full it is and whether a limit keeps it out. */
export async function onClaudeAccounts(): Promise<AccountsView> {
  const now = accountsWiring.now()
  const live = await contextQuota()
    .read()
    .then(view => view.windows)
    .catch(() => [])
  const rows = readAccounts(accountsWiring.path()).map(account => row(account, live, now))
  // The first free one is the one a run takes; with one account there is no order to say.
  if (rows.length > 1) {
    const free = rows.filter(r => r.limitedUntil === undefined)
    for (const r of rows) if (r.limitedUntil !== undefined) r.state = 'limited'
    if (free[0]) free[0].state = 'in-use'
    if (free[1]) free[1].state = 'next'
  }
  return {
    accounts: rows,
    ...(adding ? { adding } : {}),
    ...(failed !== undefined ? { failed } : {}),
    now,
  }
}

export type AccountResult = { ok: true } | { ok: false; error: string }

/** The name refused before the browser opens: empty, or one an account has. */
function nameTaken(name: string): string | undefined {
  const said = name.trim()
  if (said === '') return 'An account needs a name.'
  const own = readAccounts(accountsWiring.path()).find(a => a.login === undefined)
  const shown = own && own.name === OWN_NAME ? ownName() : undefined
  if (readAccounts(accountsWiring.path()).some(a => a.name.toLowerCase() === said.toLowerCase()) || shown?.toLowerCase() === said.toLowerCase()) return `There is an account named ${said} already.`
  return undefined
}

/**
 * Add an account: this computer's browser opens on Claude's page, the person says yes there
 * (signed in to the account being added), and the login Claude Code makes is kept under `name`.
 * Answers at once; the page follows it in {@link onClaudeAccounts}.
 */
export async function sendAddClaudeAccount(name: string): Promise<AccountResult> {
  if (adding)
    return {
      ok: false,
      error: `${adding.name}'s account is being added: say yes in the page the browser opened, or wait for it to end.`,
    }
  const refused = nameTaken(name)
  if (refused) return { ok: false, error: refused }
  const said = name.trim()
  adding = { name: said }
  failed = undefined
  void accountsWiring
    .mint()
    .then(minted => {
      if (!minted.ok) failed = minted.error
      else addAccount(said, minted.login, accountsWiring.path(), new Date(accountsWiring.now()))
    })
    .catch((err: unknown) => {
      failed = err instanceof Error ? err.message : String(err)
    })
    .finally(() => {
      adding = undefined
    })
  return { ok: true }
}

/** Remove an added account. Its login is not ended: it is good until its year is over, or until it is taken back on claude.ai. */
export async function sendRemoveClaudeAccount(name: string): Promise<AccountResult> {
  return change(() => removeAccount(name, accountsWiring.path()))
}

/** Runs try `name` first from now on. */
export async function sendUseClaudeAccountFirst(name: string): Promise<AccountResult> {
  return change(() => useFirst(name, accountsWiring.path()))
}

/** The person's own login under the name they give it. */
export async function sendNameOwnClaudeAccount(name: string): Promise<AccountResult> {
  return change(() => nameOwnAccount(name, accountsWiring.path()))
}

function change(act: () => unknown): AccountResult {
  try {
    act()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

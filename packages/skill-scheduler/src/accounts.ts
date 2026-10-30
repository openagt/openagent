import type { DriverQuota, DriverQuotaWindow, DriverRateWindow } from '@openagt/agent-driver'
import { type AgentAccount } from '@openagt/agent-driver'
import { quotaBoundaryStatus, quotaHeadroom } from './quota-boundary.js'
import { freesIn, isLimited } from '@openagt/skill-account-rotation'

// Unattended work on several accounts of one agent: it starts when any account is under its line,
// and on that one. How an account's windows are read is the agent's: Claude's own login live,
// an added one by what the last turn on it said (its login may not read `/usage`); every Codex
// login live, from its own home.

/** How long each of the windows a rate-limit line names lasts: one past its reset has begun again. */
const LASTS: Record<string, number> = { five_hour: 5 * 60 * 60_000, thirty_day: 30 * 24 * 60 * 60_000 }
const WEEK_MS = 7 * 24 * 60 * 60_000

/** An account's windows as the boundary reads them; one whose reset has passed is empty again, until its next. */
export function accountWindows(windows: readonly DriverRateWindow[], now: number): DriverQuotaWindow[] {
  return windows.map(w => {
    const lasts = LASTS[w.window] ?? WEEK_MS
    let resetsAt = w.resetsAt
    while (resetsAt <= now) resetsAt += lasts
    const percentUsed = resetsAt === w.resetsAt ? w.percentUsed : 0
    return { ...labelled(w.window), percentUsed, resetsAt }
  })
}

/**
 * A rate-limit line's window by the names `/usage` gives it: `seven_day_opus` is the Opus week.
 * Codex's 30-day window is no week: the boundary paces a week's allowance over its seven days, and
 * a month measured against it would stand down three weeks in four. It is gated only when full.
 */
function labelled(window: string): Pick<DriverQuotaWindow, 'label' | 'kind'> {
  if (window === 'five_hour') return { label: 'Current session', kind: 'session' }
  if (window === 'seven_day') return { label: 'Current week (all models)', kind: 'week' }
  if (window === 'thirty_day') return { label: 'Current month', kind: 'unknown' }
  const model = /^seven_day_(.+)$/.exec(window)?.[1]
  if (model) return { label: `Current week (${model[0]!.toUpperCase()}${model.slice(1)})`, kind: 'week-model' }
  return { label: window, kind: 'unknown' }
}

/** What is known of how full an account is: its windows, room for sure, or why it cannot be told. */
export type AccountReading = { windows: DriverQuotaWindow[] } | { room: true } | { reason: string }

/** How an account is read. */
export type ReadAccount = (account: AgentAccount, now: number) => Promise<AccountReading>

/**
 * Claude's accounts: the person's own read live (`own`, `/usage`); an added one by what its last
 * turn said, and one no turn has said its week of yet is taken to have room: it is the account a
 * person added to be used.
 */
export function readClaudeAccount(own: () => Promise<DriverQuota>): ReadAccount {
  return async (account, now) => {
    if (account.login === undefined) {
      const quota = await own()
      return quota.available ? { windows: quota.windows } : { reason: `${account.name}'s quota could not be read` }
    }
    const windows = accountWindows(account.windows ?? [], now)
    return windows.some(w => w.kind === 'week') ? { windows } : { room: true }
  }
}

/**
 * Codex's accounts, each read live from its own home (`usage`). A week is gated by the boundary as
 * Claude's is; an account with none (a plan with only a month) has room until a window is full.
 */
export function readCodexAccount(usage: (account: AgentAccount) => Promise<DriverRateWindow[]>): ReadAccount {
  return async (account, now) => {
    const read = await usage(account).then(
      windows => accountWindows(windows, now),
      () => undefined,
    )
    if (read === undefined) return { reason: `${account.name}'s usage could not be read` }
    if (read.some(w => w.kind === 'week')) return { windows: read }
    const full = read.find(w => w.percentUsed >= 100)
    return full ? { reason: `${account.name}: ${full.label} is used up` } : { room: true }
  }
}

/** The account unattended work goes on, or why none: every account at its limit or past its line. */
export async function accountWithRoom(
  accounts: readonly AgentAccount[],
  read: ReadAccount,
  input: { now: number; model?: string; limitOffset?: number },
  agent = 'Claude',
): Promise<{ account: string } | { reason: string }> {
  const why: string[] = []
  for (const account of accounts) {
    if (isLimited(account, input.now)) {
      why.push(`${account.name} is at its limit, free again in ${freesIn(account.limitedUntil!, input.now)}`)
      continue
    }
    const reading = await read(account, input.now)
    if ('room' in reading) return { account: account.name }
    if ('reason' in reading) {
      why.push(reading.reason)
      continue
    }
    const headroom = quotaHeadroom(quotaBoundaryStatus({ windows: reading.windows, ...input }))
    if (headroom.start) return { account: account.name }
    why.push(`${account.name}: ${headroom.reason}`)
  }
  return { reason: `every ${agent} account is past its line (${why.join('; ')})` }
}

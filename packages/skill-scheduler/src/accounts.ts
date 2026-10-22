import type { DriverQuota, DriverQuotaWindow, DriverRateWindow } from '@openagt/agent-driver'
import { freesIn, isLimited, type AgentAccount } from '@openagt/agent-driver'
import { quotaBoundaryStatus, quotaHeadroom } from './quota-boundary.js'

// Unattended work on several Claude accounts: it starts when any account is under its line, and
// on that one. The person's own login is read as it always was, live; an added one is known only
// by what the last turn on it said (its login may not read `/usage`), and one no turn has said
// anything of yet is taken to have room: it is the account a person added to be used.

/** How long each of the windows a rate-limit line names lasts: one past its reset has begun again. */
const LASTS: Record<string, number> = { five_hour: 5 * 60 * 60_000 }
const WEEK_MS = 7 * 24 * 60 * 60_000

/** An added account's windows as the boundary reads them; one whose reset has passed is empty again, until its next. */
export function accountWindows(windows: readonly DriverRateWindow[], now: number): DriverQuotaWindow[] {
  return windows.map(w => {
    const lasts = LASTS[w.window] ?? WEEK_MS
    let resetsAt = w.resetsAt
    while (resetsAt <= now) resetsAt += lasts
    const percentUsed = resetsAt === w.resetsAt ? w.percentUsed : 0
    return { ...labelled(w.window), percentUsed, resetsAt }
  })
}

/** A rate-limit line's window by the names `/usage` gives it: `seven_day_opus` is the Opus week. */
function labelled(window: string): Pick<DriverQuotaWindow, 'label' | 'kind'> {
  if (window === 'five_hour') return { label: 'Current session', kind: 'session' }
  if (window === 'seven_day') return { label: 'Current week (all models)', kind: 'week' }
  const model = /^seven_day_(.+)$/.exec(window)?.[1]
  if (model) return { label: `Current week (${model[0]!.toUpperCase()}${model.slice(1)})`, kind: 'week-model' }
  return { label: window, kind: 'unknown' }
}

/** The account unattended work goes on, or why none: every account at its limit or past its line. */
export async function accountWithRoom(
  accounts: readonly AgentAccount[],
  own: () => Promise<DriverQuota>,
  input: { now: number; model?: string; limitOffset?: number },
): Promise<{ account: string } | { reason: string }> {
  const why: string[] = []
  for (const account of accounts) {
    if (isLimited(account, input.now)) {
      why.push(`${account.name} is at its limit, free again in ${freesIn(account.limitedUntil!, input.now)}`)
      continue
    }
    let windows: DriverQuotaWindow[]
    if (account.login === undefined) {
      const quota = await own()
      if (!quota.available) {
        why.push(`${account.name}'s quota could not be read`)
        continue
      }
      windows = quota.windows
    } else {
      windows = accountWindows(account.windows ?? [], input.now)
      // Nothing said of its week yet: the account is there to be used.
      if (!windows.some(w => w.kind === 'week')) return { account: account.name }
    }
    const headroom = quotaHeadroom(quotaBoundaryStatus({ windows, ...input }))
    if (headroom.start) return { account: account.name }
    why.push(`${account.name}: ${headroom.reason}`)
  }
  return { reason: `every Claude account is past its line (${why.join('; ')})` }
}

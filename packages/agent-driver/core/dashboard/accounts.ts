import { usePolled, type ModuleHost } from '@openagt/ui/module'
import type { UsageWindow } from '@openagt/hooks'
import { server } from './reads.js'

// A list's accounts as the menu under the message box and the usage card show them: in the order
// runs try them, each by its name, how full it is and whether a limit keeps it out. Read off the
// server part's `list` and `usage`, what the accounts card reads too; changing which one is first
// goes through the package's command, as an agent does.

/** One of an account's usage windows, by how long it lasts. */
export interface AccountWindow {
  /** `5 h`, `week`, `month`. */
  label: string
  /** How much of it is gone, 0-100. */
  percent: number
}

/** One account as the menu and the usage card show it. */
export interface AccountRow {
  /** The account as the list names it: what a command takes. */
  id: string
  /** Its name as shown: the person's own goes by the agent's name for them until they give it one. */
  name: string
  /** The person's own login, which the agent keeps. */
  own: boolean
  /** The person's own, and the agent has no such login: runs skip it while another account is there. */
  loggedOut?: true
  /** How full it is, shortest window first; none when nothing said it yet. */
  windows: AccountWindow[]
  /** When those were said, epoch ms, when not now: an added Claude account is known from its last run. */
  asOf?: number
  /** Until when a limit keeps it out, epoch ms. */
  limitedUntil?: number
  /** `in-use`: the first one a run takes now; `next`: the one after it; `limited`: a limit keeps it out. */
  state?: 'in-use' | 'next' | 'limited'
}

export interface AccountsView {
  accounts: AccountRow[]
  /** When it was read, so "free in 2 h" is counted from the same now. */
  now: number
}

/** An account as `list` says it. */
interface Listed {
  name: string
  who?: string
  signedOut?: true
  own: boolean
  limitedUntil?: number
}

/** How full an account is, as `usage` says it. */
interface Used {
  name: string
  windows: UsageWindow[]
  at?: number
}

/** What a window is called by how long it lasts. */
const LABELS: Record<string, string> = { five_hour: '5 h', seven_day: 'week', thirty_day: 'month' }

/** The package's command that changes which account is first. */
const COMMAND = 'account-rotation'

/** How often a list is asked again. */
const SELDOM_MS = 30_000

/** A list's rows, from what `list` and `usage` answered for it. */
export function accountRows(listed: readonly Listed[], used: readonly Used[], now: number): AccountRow[] {
  const rows = listed.map((account): AccountRow => {
    const usage = used.find(one => one.name === account.name)
    return {
      id: account.name,
      name: account.who ?? account.name,
      own: account.own,
      ...(account.signedOut ? { loggedOut: true as const } : {}),
      windows: (usage?.windows ?? []).flatMap(window => (LABELS[window.window] !== undefined ? [{ label: LABELS[window.window]!, percent: window.percentUsed }] : [])),
      ...(usage?.at !== undefined ? { asOf: usage.at } : {}),
      ...(account.limitedUntil !== undefined && account.limitedUntil > now ? { limitedUntil: account.limitedUntil } : {}),
    }
  })
  // The first free one is the one a run takes; with one account there is no order to say.
  if (rows.length > 1) {
    const free = rows.filter(row => row.limitedUntil === undefined && (!row.loggedOut || rows.every(other => other.own)))
    for (const row of rows) if (row.limitedUntil !== undefined) row.state = 'limited'
    if (free[0]) free[0].state = 'in-use'
    if (free[1]) free[1].state = 'next'
  }
  return rows
}

/**
 * Every list's accounts (`claude`, `codex`), none asked while `on` is off, and how one is made the
 * first its list's runs take, as the accounts card does: the next run goes with it.
 */
export function useAllAccounts(host: ModuleHost, on = true): { views: Record<string, AccountsView> | undefined; pick: (list: string, account: string) => Promise<void> } {
  const { value, reload } = usePolled<Record<string, AccountsView> | undefined>(
    on
      ? async () => {
          const [listed, used] = await Promise.all([server(host).list({}), server(host).usage({})])
          const now = Date.now()
          const lists = Object.keys(used)
          return Object.fromEntries(lists.map(list => [list, { accounts: accountRows((listed[list] ?? []) as Listed[], (used[list] ?? []) as Used[], now), now }]))
        }
      : null,
    undefined,
    SELDOM_MS,
    [on],
    { remember: 'agent-driver:accounts' },
  )
  return {
    views: value,
    pick: async (list, account) => {
      await host.runComputerCommand(['use-first', list, account], COMMAND)
      await reload()
    },
  }
}

/** One list's accounts, as {@link useAllAccounts} reads them. */
export function useAccounts(host: ModuleHost, list: string | undefined, on = true): { view: AccountsView | undefined; pick: (account: string) => Promise<void> } {
  const { views, pick } = useAllAccounts(host, on && list !== undefined)
  return { view: list !== undefined ? views?.[list] : undefined, pick: account => (list !== undefined ? pick(list, account) : Promise.resolve()) }
}

/** The accounts a run can take: the person's own is left out when the agent has no such login and another account is there. */
export function runAccounts(view: AccountsView): AccountRow[] {
  const there = view.accounts.filter(account => !account.loggedOut)
  return there.length > 0 ? there : view.accounts
}

/** The longest window an account says, the one its bar shows: the week, or Codex's month. */
export function longest(account: AccountRow): AccountWindow | undefined {
  return account.windows[account.windows.length - 1]
}

/** The account an agent's runs take first, as its row in the agent menu says it: its name, and how full it is. */
export function firstAccount(view: AccountsView | undefined): { name: string; percent: string | undefined } | undefined {
  const first = view && runAccounts(view)[0]
  if (!first) return undefined
  const window = longest(first)
  return { name: first.name, percent: first.state === 'limited' ? 'limited' : window !== undefined ? `${Math.round(window.percent)}%` : undefined }
}

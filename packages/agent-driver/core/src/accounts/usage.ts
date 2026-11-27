import { accountsFor, readAccounts } from './accounts.js'
import { callerFromEnv } from '@openagt/hooks'
import type { LoginWiring } from './wiring.js'
import type { AgentAccount, AgentLogins, UsageWindow } from '@openagt/hooks'

// How full each account is, now where it can be known: the agent reads it where it can
// (`RunAgent.accounts`: Claude Code the person's own login, Codex every login), and an account it
// cannot read says what its last run saw.

/** How full one account is, as `usage` answers: its windows shortest first. `at` when this is what its last run saw rather than a reading now. */
export interface AccountUsage {
  name: string
  windows: UsageWindow[]
  at?: number
}

/** The windows a person reads, shortest first; one gone past its reset is empty again. */
function shown(windows: readonly UsageWindow[], now: number): UsageWindow[] {
  const order = ['five_hour', 'seven_day', 'thirty_day']
  return windows
    .filter(window => order.includes(window.window))
    .map(window => (window.resetsAt !== undefined && window.resetsAt <= now ? { ...window, percentUsed: 0 } : window))
    .sort((a, b) => order.indexOf(a.window) - order.indexOf(b.window))
}

async function accountUsage(logins: AgentLogins, account: AgentAccount, wiring: LoginWiring): Promise<AccountUsage> {
  const live = await logins.usage(account, wiring.env).catch(() => undefined)
  const now = wiring.now()
  if (live) return { name: account.name, windows: shown(live, now) }
  return { name: account.name, windows: shown(account.windows ?? [], now), ...(account.windowsAt !== undefined ? { at: account.windowsAt } : {}) }
}

/** How full each account of each list is, in the order runs try them: on a machine shared by a team, the caller's and the shared ones. */
export async function readUsage(wiring: LoginWiring): Promise<Record<string, AccountUsage[]>> {
  const all = await wiring.logins()
  const caller = callerFromEnv(wiring.env)
  const read = await Promise.all(all.map(logins => Promise.all(accountsFor(readAccounts(wiring.path(logins.list)), caller).map(account => accountUsage(logins, account, wiring)))))
  return Object.fromEntries(all.map((logins, at) => [logins.list, read[at]!]))
}

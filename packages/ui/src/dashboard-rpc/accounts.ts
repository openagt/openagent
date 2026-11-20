import { computerName } from '../computer-name.js'
import { accountFolder, codexAccountsDir, personalCodexHome, readCodexUsage } from '@openagt/agent-driver-codex'
import { comesBackFrom, handedOverBy, isLimited, loginWiring, OWN_NAME, readAccounts, removeAdded, useFirst, type LoginWiring } from '@openagt/agent-driver'
import { contextQuota } from './context.js'
import { readCopied, type CopiedLogin } from '../dashboard/copied-logins.js'
import type { AgentAccount, AgentLogins, DriverQuotaWindow, DriverRateWindow } from '@openagt/hooks'

// The accounts runs use, per coding agent (`@openagt/agent-driver`'s): the person's own login,
// which the agent keeps, and the ones added beside it. A page sees each one's name, how full it is
// and whether a limit keeps it out, never a login. Adding and logging out are agent-driver's own,
// through its command. On a server, an account may also be a login of the person's own computer
// (`copied-logins.ts`): its row says which computer, and how full the computer last read it.

/** The coding agents whose accounts a page shows, by their list: Claude Code's and Codex's. */
export type AccountsAgent = 'claude' | 'codex'

/** One of an account's usage windows, by how long it lasts. */
export interface AccountWindow {
  /** `5 h`, `week`, `month`. */
  label: string
  /** How much of it is gone, 0-100. */
  percent: number
}

/** One account as the page shows it. */
export interface AccountRow {
  /** The account as the file names it: what the page sends back to act on it. */
  id: string
  /** Its name as shown: the person's own goes by the agent's name for them until they give it one. */
  name: string
  /** A login of the person's own computer, by that computer's name: a server's copy of it. */
  from?: string
  /** Removed here it would only be handed over again: it is removed on that computer. */
  comesBack?: true
  /** The person's own login, which the agent keeps: logged out, never removed. */
  own: boolean
  /** The person's own, and the agent has no such login: runs skip it while another account is there, and no page offers it then. */
  loggedOut?: true
  /** When an added one was added, ISO 8601. */
  added?: string
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
  /** This computer's own name: what its own login's row says it is on. */
  computer: string
  /** On a server: the computer of the person's whose logins it uses, by its name. */
  from?: string
  /** The daemon's clock, so "free in 2 h" is counted from the same now. */
  now: number
}

/** What the RPCs reach for, swapped in tests: the lists and what each agent knows of its own logins, where a Codex login is and how full it is. */
export const accountsWiring: LoginWiring & {
  /** This computer's own name. */
  computer: () => string
  /** Where an added Codex account's login is kept, a folder each. */
  codexDir: () => string
  /** The person's own Codex home, where their login is. */
  codexOwnHome: () => string
  /** An added Codex account's folder. */
  codexFolder: (account: AgentAccount) => string
  /** How full the Codex login in a home is, now. */
  codexUsage: (home: string) => Promise<DriverRateWindow[]>
} = {
  ...loginWiring(),
  computer: computerName,
  codexDir: () => codexAccountsDir(),
  codexOwnHome: () => personalCodexHome(),
  codexFolder: account => accountFolder(account),
  codexUsage: home => readCodexUsage({ home }),
}

/** What the agent of `agent`'s list knows of its own logins (`RunAgent.accounts`), as the distribution gives it. */
async function loginsOf(agent: AccountsAgent): Promise<AgentLogins | undefined> {
  return (await accountsWiring.logins()).find(logins => logins.list === agent)
}

/** How long a Codex reading is kept: the page asks every few seconds, and each reading starts a Codex. */
const CODEX_KEPT_MS = 60_000
const codexKept = new Map<string, { at: number; windows: Promise<DriverRateWindow[] | undefined> }>()

/** How full the Codex account logged in at `home` is: read now, or less than a minute ago. None when Codex could not say. */
function codexUsage(home: string, now: number): Promise<DriverRateWindow[] | undefined> {
  const kept = codexKept.get(home)
  if (kept && now - kept.at < CODEX_KEPT_MS && now >= kept.at) return kept.windows
  const windows = accountsWiring.codexUsage(home).catch(() => undefined)
  codexKept.set(home, { at: now, windows })
  return windows
}

/** What a window is called by how long it lasts. */
const LABELS: Record<string, string> = { five_hour: '5 h', seven_day: 'week', thirty_day: 'month' }
const ORDER = ['5 h', 'week', 'month']

/** A turn's or an agent's windows as the page names them, shortest first; a window gone past its reset is empty again. */
function windowsOf(windows: readonly DriverRateWindow[], now: number): AccountWindow[] {
  return windows
    .filter(w => LABELS[w.window] !== undefined)
    .map(w => ({ label: LABELS[w.window]!, percent: w.resetsAt <= now ? 0 : w.percentUsed }))
    .sort((a, b) => ORDER.indexOf(a.label) - ORDER.indexOf(b.label))
}

/** Claude Code's own `/usage` reading of the person's login, as the page names its windows. */
function liveClaude(windows: DriverQuotaWindow[]): AccountWindow[] {
  const session = windows.find(w => w.kind === 'session')
  const week = windows.find(w => w.kind === 'week')
  return [...(session ? [{ label: '5 h', percent: session.percentUsed }] : []), ...(week ? [{ label: 'week', percent: week.percentUsed }] : [])]
}

/** What the person's own login is called before they name it: never "this computer", which reads as whichever computer the page is open on. */
const AGENT_NAMES: Record<AccountsAgent, string> = { claude: 'Claude', codex: 'Codex' }

/**
 * One account's row. Claude's own login is read live where Claude Code lets it be (`/usage`), an
 * added one from its last run, a login of the person's computer from the last reading it sent when
 * that is newer; every Codex one live.
 */
async function row(agent: AccountsAgent, logins: AgentLogins | undefined, account: AgentAccount, liveOwn: DriverQuotaWindow[], copies: CopiedLogin[], now: number): Promise<AccountRow> {
  const own = account.login === undefined
  const name = own && account.name === OWN_NAME ? ((await logins?.ownName(accountsWiring.env)) ?? `${AGENT_NAMES[agent]} login on ${accountsWiring.computer()}`) : account.name
  const copy = own ? undefined : copies.find(login => login.name === account.name)
  const said = (): Pick<AccountRow, 'windows' | 'asOf'> => {
    if (copy?.usage && (account.windowsAt === undefined || copy.usage.at > account.windowsAt)) return { windows: copy.usage.windows, asOf: copy.usage.at }
    return { windows: windowsOf(account.windows ?? [], now), ...(account.windowsAt !== undefined ? { asOf: account.windowsAt } : {}) }
  }
  let reading: Pick<AccountRow, 'windows' | 'asOf'>
  if (agent === 'claude') reading = own && liveOwn.length > 0 ? { windows: liveClaude(liveOwn) } : said()
  else {
    const live = await codexUsage(own ? accountsWiring.codexOwnHome() : accountsWiring.codexFolder(account), now)
    reading = live ? { windows: windowsOf(live, now) } : said()
  }
  return {
    id: account.name,
    name,
    ...(copy ? { from: copy.from } : {}),
    ...(!own && handedOverBy(agent, accountsWiring.env).get(account.name)?.comesBack ? { comesBack: true as const } : {}),
    own,
    ...(own && !(logins?.ownLoginThere(accountsWiring.env) ?? false) ? { loggedOut: true as const } : {}),
    ...(account.added !== undefined ? { added: account.added } : {}),
    ...reading,
    ...(isLimited(account, now) ? { limitedUntil: account.limitedUntil! } : {}),
  }
}

/** An agent's accounts in the order runs try them, each with how full it is and whether a limit keeps it out. */
export async function onAgentAccounts(agent: AccountsAgent): Promise<AccountsView> {
  const now = accountsWiring.now()
  const liveOwn =
    agent === 'claude'
      ? await contextQuota()
          .read()
          .then(view => view.windows)
          .catch(() => [])
      : []
  const copied = readCopied()
  const copies = copied.filter(login => login.kind === agent)
  const logins = await loginsOf(agent)
  const rows = await Promise.all(readAccounts(accountsWiring.path(agent)).map(account => row(agent, logins, account, liveOwn, copies, now)))
  // The first free one is the one a run takes; with one account there is no order to say.
  if (rows.length > 1) {
    const free = rows.filter(r => r.limitedUntil === undefined && (!r.loggedOut || rows.every(other => other.own)))
    for (const r of rows) if (r.limitedUntil !== undefined) r.state = 'limited'
    if (free[0]) free[0].state = 'in-use'
    if (free[1]) free[1].state = 'next'
  }
  const from = copied[0]?.from
  return {
    accounts: rows,
    computer: accountsWiring.computer(),
    ...(from !== undefined ? { from } : {}),
    now,
  }
}

export type AccountResult = { ok: true } | { ok: false; error: string }

/** Remove an added account (`removeAdded`). */
export async function sendRemoveAgentAccount(agent: AccountsAgent, name: string): Promise<AccountResult> {
  try {
    const from = comesBackFrom(agent, name, accountsWiring)
    if (from !== undefined) return { ok: false, error: `${name}'s account comes from ${from}: remove it there.` }
    const logins = await loginsOf(agent)
    if (!logins) return { ok: false, error: `No coding agent here keeps ${AGENT_NAMES[agent]} accounts.` }
    await removeAdded(logins, name, accountsWiring)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Runs try `name` first from now on. */
export async function sendUseAgentAccountFirst(agent: AccountsAgent, name: string): Promise<AccountResult> {
  return change(() => useFirst(name, accountsWiring.path(agent)))
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

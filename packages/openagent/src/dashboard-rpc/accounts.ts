import { computerName } from '../computer-name.js'
import type { AgentAccount, DriverQuotaWindow, DriverRateWindow } from '@openagt/agent-driver'
import { addingNow, beginAdding, bringCode, cancelAdding, comesBackFrom, handedOverBy, isLimited, logOut, loginWiring, nameOwnAccount, OWN_NAME, ownLoginThere, ownName, readAccounts, removeAdded, useFirst, type AccountsAgent, type LoginWiring } from '@openagt/skill-account-rotation'
import { contextQuota } from './context.js'
import { readCopied, type CopiedLogin } from '../dashboard/copied-logins.js'

// The accounts runs use, per coding agent (`@openagt/skill-account-rotation`): the person's own
// login, which the agent keeps, and the ones added beside it. A page sees each one's name, how full
// it is and whether a limit keeps it out, never a login. Adding one is the skill's own: a name first,
// then a sign-in that goes on by itself, in this computer's browser or on the person's own device.
// Claude Code makes a login that lasts a year; Codex keeps the account's login in a folder of its
// own, where it renews it. A server has no browser: there the person signs in on the device they
// read its page on, from a link, and pastes back the code Claude's page shows, or types Codex's
// code at its page. On a server, an account may also be a login of the person's own computer
// (`copied-logins.ts`): its row says which computer, and how full the computer last read it.

export type { AccountsAgent }

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

/** An account being added: the browser is open on the agent's page, or the login is being kept. */
export interface AccountAdding {
  name: string
  /** The page to sign in at, when the agent gave one: what a person copies into a private window when the browser is signed in to another account, or opens on their device where this computer has no browser. */
  url?: string
  /** No browser here: the code Codex gave, which the person types at {@link url}. */
  code?: string
  /** No browser here: Claude's page shows a code once the person said yes, which they paste back. */
  paste?: true
  /** The code pasted back is with Claude. */
  checking?: true
  /** Claude did not take the code pasted back: it waits for another. */
  refused?: true
}

export interface AccountsView {
  accounts: AccountRow[]
  /** This computer's own name: what its own login's row says it is on. */
  computer: string
  /** On a server: the computer of the person's whose logins it uses, by its name. */
  from?: string
  adding?: AccountAdding
  /** Why the last add did not go through. */
  failed?: string
  /** This computer has no browser, a server: the person signs in on their own device. */
  noBrowser?: true
  /** The daemon's clock, so "free in 2 h" is counted from the same now. */
  now: number
}

/** What the RPCs reach for, swapped in tests: the logins, how full a Codex account is. */
export const accountsWiring: LoginWiring & {
  /** This computer's own name. */
  computer: () => string
} = {
  ...loginWiring(),
  computer: computerName,
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
async function row(agent: AccountsAgent, account: AgentAccount, liveOwn: DriverQuotaWindow[], copies: CopiedLogin[], now: number): Promise<AccountRow> {
  const own = account.login === undefined
  const name = own && account.name === OWN_NAME ? ((await ownName(agent, accountsWiring)) ?? `${AGENT_NAMES[agent]} login on ${accountsWiring.computer()}`) : account.name
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
    ...(own && !ownLoginThere(agent, accountsWiring) ? { loggedOut: true as const } : {}),
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
  const rows = await Promise.all(readAccounts(accountsWiring.path(agent)).map(account => row(agent, account, liveOwn, copies, now)))
  // The first free one is the one a run takes; with one account there is no order to say.
  if (rows.length > 1) {
    const free = rows.filter(r => r.limitedUntil === undefined && (!r.loggedOut || rows.every(other => other.own)))
    for (const r of rows) if (r.limitedUntil !== undefined) r.state = 'limited'
    if (free[0]) free[0].state = 'in-use'
    if (free[1]) free[1].state = 'next'
  }
  const { adding: beingAdded, failed: lastFailed, noBrowser } = addingNow(agent, accountsWiring)
  const from = copied[0]?.from
  return {
    accounts: rows,
    computer: accountsWiring.computer(),
    ...(from !== undefined ? { from } : {}),
    ...(beingAdded ? { adding: beingAdded } : {}),
    ...(lastFailed !== undefined ? { failed: lastFailed } : {}),
    ...(noBrowser ? { noBrowser } : {}),
    now,
  }
}

export type AccountResult = { ok: true } | { ok: false; error: string }

/** Start adding an account: the skill's own sign-in, which goes on by itself and which {@link onAgentAccounts} follows. */
export async function sendAddAgentAccount(agent: AccountsAgent, name: string): Promise<AccountResult> {
  return beginAdding(agent, name, accountsWiring)
}

/** Hand the sign-in the code its page showed the person, on a computer with no browser of its own. */
export async function sendAgentAccountCode(agent: AccountsAgent, code: string): Promise<AccountResult> {
  return bringCode(agent, code, accountsWiring)
}

/** Stop adding an account. */
export async function sendCancelAddingAccount(agent: AccountsAgent): Promise<AccountResult> {
  cancelAdding(agent, accountsWiring)
  return { ok: true }
}

/** Log the person's own login out (`logOut`): their terminal too. */
export async function sendLogOutAgent(agent: AccountsAgent): Promise<AccountResult> {
  const failed = await logOut(agent, accountsWiring)
  return failed === undefined ? { ok: true } : { ok: false, error: failed }
}

/** Remove an added account (`removeAdded`). */
export async function sendRemoveAgentAccount(agent: AccountsAgent, name: string): Promise<AccountResult> {
  try {
    const from = comesBackFrom(agent, name, accountsWiring)
    if (from !== undefined) return { ok: false, error: `${name}'s account comes from ${from}: remove it there.` }
    await removeAdded(agent, name, accountsWiring)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Runs try `name` first from now on. */
export async function sendUseAgentAccountFirst(agent: AccountsAgent, name: string): Promise<AccountResult> {
  return change(() => useFirst(name, accountsWiring.path(agent)))
}

/** The person's own login under the name they give it. */
export async function sendNameOwnAgentAccount(agent: AccountsAgent, name: string): Promise<AccountResult> {
  return change(() => nameOwnAccount(name, accountsWiring.path(agent)))
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

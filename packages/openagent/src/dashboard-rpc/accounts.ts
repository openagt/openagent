import { computerName } from '../computer-name.js'
import type { AgentAccount, DriverQuotaWindow, DriverRateWindow } from '@openagt/agent-driver'
import { isLimited, loginWiring, nameOwnAccount, nameTaken, OWN_NAME, ownName, readAccounts, removeAdded, signIn, useFirst, type AccountsAgent, type LoginWiring, type SignInSaid } from '@openagt/skill-account-rotation'
import { contextQuota } from './context.js'
import { readCopied, writeCopied, type CopiedLogin } from '../dashboard/copied-logins.js'

// The accounts runs use, per coding agent (`@openagt/skill-account-rotation`): the person's own
// login, which the agent keeps, and the ones added beside it. A page sees each one's name, how full
// it is and whether a limit keeps it out, never a login. Adding one is the same for every agent: a
// name first, then this computer's browser, where the person signs in to the account being added.
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
  /** The person's own login, which the agent keeps: it is never removed. */
  own: boolean
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
  /** The daemon's clock, so "free in 2 h" is counted from the same now. */
  now: number
}

/** What the RPCs reach for, swapped in tests: the logins, how full a Codex account is. */
export const accountsWiring: LoginWiring & {
  /** No browser on this computer: a server's. */
  headless: () => boolean
  /** This computer's own name. */
  computer: () => string
} = {
  ...loginWiring(),
  headless: () => process.env['OPENAGENT_SERVER'] === '1',
  computer: computerName,
}

const adding = new Map<AccountsAgent, AccountAdding>()
const failed = new Map<AccountsAgent, string>()
/** Where a code the person pastes back goes: Claude Code, waiting for it on a server. */
const pastes = new Map<AccountsAgent, (code: string) => boolean>()

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
    own,
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
  const copies = readCopied().filter(login => login.kind === agent)
  const rows = await Promise.all(readAccounts(accountsWiring.path(agent)).map(account => row(agent, account, liveOwn, copies, now)))
  // The first free one is the one a run takes; with one account there is no order to say.
  if (rows.length > 1) {
    const free = rows.filter(r => r.limitedUntil === undefined)
    for (const r of rows) if (r.limitedUntil !== undefined) r.state = 'limited'
    if (free[0]) free[0].state = 'in-use'
    if (free[1]) free[1].state = 'next'
  }
  const beingAdded = adding.get(agent)
  const lastFailed = failed.get(agent)
  const from = rows.find(r => r.from !== undefined)?.from
  return {
    accounts: rows,
    computer: accountsWiring.computer(),
    ...(from !== undefined ? { from } : {}),
    ...(beingAdded ? { adding: beingAdded } : {}),
    ...(lastFailed !== undefined ? { failed: lastFailed } : {}),
    now,
  }
}

export type AccountResult = { ok: true } | { ok: false; error: string }

/** How the page follows a sign-in: on a server it shows where to sign in, and takes back Claude's code. */
function signInSaid(agent: AccountsAgent, name: string): SignInSaid {
  if (agent === 'codex') return accountsWiring.headless() ? { onCode: (code, url) => void adding.set(agent, { name, url, code }) } : { onUrl: url => void adding.set(agent, { name, url }) }
  return accountsWiring.headless()
    ? {
        onLink: (url, paste) => {
          pastes.set(agent, paste)
          adding.set(agent, { name, url, paste: true })
        },
      }
    : {}
}

/**
 * Add an account: this computer's browser opens on the agent's page, the person signs in there to
 * the account being added, and its login is kept under `name`. Answers at once; the page follows it
 * in {@link onAgentAccounts}.
 */
export async function sendAddAgentAccount(agent: AccountsAgent, name: string): Promise<AccountResult> {
  const busy = adding.get(agent)
  if (busy)
    return {
      ok: false,
      error: `${busy.name}'s account is being added: sign in on the page it gave, or wait for it to end.`,
    }
  const refused = await nameTaken(agent, name, accountsWiring)
  if (refused) return { ok: false, error: refused }
  const said = name.trim()
  adding.set(agent, { name: said })
  failed.delete(agent)
  void signIn(agent, said, accountsWiring, signInSaid(agent, said))
    .then(error => {
      if (error !== undefined) failed.set(agent, error)
    })
    .catch((err: unknown) => {
      failed.set(agent, err instanceof Error ? err.message : String(err))
    })
    .finally(() => {
      adding.delete(agent)
      pastes.delete(agent)
    })
  return { ok: true }
}

/** Hand Claude Code the code its page showed the person, on a computer with no browser of its own. */
export async function sendAgentAccountCode(agent: AccountsAgent, code: string): Promise<AccountResult> {
  const paste = pastes.get(agent)
  if (!paste) return { ok: false, error: 'No login waits for a code: start it again.' }
  return typeof code === 'string' && paste(code) ? { ok: true } : { ok: false, error: 'That is not the code the page shows: copy it whole, and paste it here.' }
}

/** Remove an added account (`removeAdded`). */
export async function sendRemoveAgentAccount(agent: AccountsAgent, name: string): Promise<AccountResult> {
  try {
    const gone = await removeAdded(agent, name, accountsWiring)
    // One a computer of the person's handed over is no longer here: that computer offers it again.
    if (gone) writeCopied(readCopied().filter(login => login.kind !== agent || login.name !== name))
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

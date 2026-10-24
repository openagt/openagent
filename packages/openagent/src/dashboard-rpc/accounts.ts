import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { computerName } from '../computer-name.js'
import { join } from 'node:path'
import { addAccount, isLimited, nameOwnAccount, nameRefused, OWN_NAME, readAccounts, removeAccount, useFirst, type AgentAccount, type DriverQuotaWindow, type DriverRateWindow } from '@openagt/agent-driver'
import { claudeAccountsPath, mintClaude, type Mint } from '@openagt/agent-driver-claude'
import { accountFolder, codexAccountsDir, codexAccountsPath, codexWho, loginCodex, personalCodexHome, readCodexUsage, type CodexLogin, type CodexLoginOptions, type CodexWho } from '@openagt/agent-driver-codex'
import { contextQuota } from './context.js'
import { readCopied, type CopiedLogin } from '../dashboard/copied-logins.js'

// The accounts runs use, per coding agent (`accounts.ts` in the driver core): the person's own
// login, which the agent keeps, and the ones added beside it. A page sees each one's name, how full
// it is and whether a limit keeps it out, never a login. Adding one is the same for every agent: a
// name first, then this computer's browser, where the person signs in to the account being added.
// Claude Code makes a login that lasts a year; Codex keeps the account's login in a folder of its
// own, where it renews it. A server has no browser: there the person signs in on the device they
// read its page on, from a link, and pastes back the code Claude's page shows, or types Codex's
// code at its page. On a server, an account may also be a login of the person's own computer
// (`copied-logins.ts`): its row says which computer, and how full the computer last read it.

/** The agents with accounts: Claude Code's and Codex's. */
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

/** What the RPCs reach for, swapped in tests: the logins, where each agent keeps who the person is, how full a Codex account is. */
export const accountsWiring: {
  mint: Mint
  claudeJson: () => string
  path: (agent: AccountsAgent) => string
  now: () => number
  loginCodex: (opts: CodexLoginOptions) => Promise<CodexLogin>
  codexDir: () => string
  codexOwnHome: () => string
  codexFolder: (account: AgentAccount) => string
  codexWho: (home: string) => Promise<CodexWho>
  codexUsage: (home: string) => Promise<DriverRateWindow[]>
  /** No browser on this computer: a server's. */
  headless: () => boolean
  /** This computer's own name. */
  computer: () => string
} = {
  mint: mintClaude,
  claudeJson: () => join(process.env['CLAUDE_CONFIG_DIR'] ?? process.env['HOME'] ?? homedir(), '.claude.json'),
  path: agent => (agent === 'codex' ? codexAccountsPath(process.env) : claudeAccountsPath(process.env)),
  now: Date.now,
  loginCodex,
  codexDir: () => codexAccountsDir(process.env),
  codexOwnHome: () => personalCodexHome(process.env),
  codexFolder: account => accountFolder(account, process.env),
  codexWho,
  codexUsage: home => readCodexUsage({ home }),
  headless: () => process.env['OPENAGENT_SERVER'] === '1',
  computer: computerName,
}

const adding = new Map<AccountsAgent, AccountAdding>()
const failed = new Map<AccountsAgent, string>()
/** Where a code the person pastes back goes: Claude Code, waiting for it on a server. */
const pastes = new Map<AccountsAgent, (code: string) => boolean>()

/** The person's own name as Claude Code knows it: its account's display name, else its email. */
function claudeOwnName(): string | undefined {
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

/** The person's own name as the agent knows it. */
async function ownName(agent: AccountsAgent): Promise<string | undefined> {
  return agent === 'codex' ? (await accountsWiring.codexWho(accountsWiring.codexOwnHome())).name : claudeOwnName()
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
  const name = own && account.name === OWN_NAME ? ((await ownName(agent)) ?? `${AGENT_NAMES[agent]} login on ${accountsWiring.computer()}`) : account.name
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

/** The name refused before the browser opens: empty, or one an account has, the person's own by the name it shows. */
async function nameTaken(agent: AccountsAgent, name: string): Promise<string | undefined> {
  const accounts = readAccounts(accountsWiring.path(agent))
  const own = accounts.find(a => a.login === undefined)
  const shown = own && own.name === OWN_NAME ? await ownName(agent) : undefined
  return nameRefused(name, shown !== undefined ? [...accounts, { name: shown }] : accounts)
}

/** Who each Codex account already on the list is: a new one that is one of them is refused. */
async function codexKeys(): Promise<string[]> {
  const homes = readAccounts(accountsWiring.path('codex')).map(a => (a.login === undefined ? accountsWiring.codexOwnHome() : accountsWiring.codexFolder(a)))
  const keys = await Promise.all(homes.map(home => accountsWiring.codexWho(home).then(who => who.key)))
  return keys.filter((key): key is string => key !== undefined)
}

/** Sign the account in, and keep it under `name`. Why not, when it did not go through. */
async function signIn(agent: AccountsAgent, name: string): Promise<string | undefined> {
  const path = accountsWiring.path(agent)
  const headless = accountsWiring.headless()
  if (agent === 'claude') {
    const minted = await accountsWiring.mint(
      headless
        ? {
            onLink: (url, paste) => {
              pastes.set(agent, paste)
              adding.set(agent, { name, url, paste: true })
            },
          }
        : {},
    )
    pastes.delete(agent)
    if (!minted.ok) return minted.error
    addAccount(name, minted.login, path, new Date(accountsWiring.now()))
    return undefined
  }
  const signed = await accountsWiring.loginCodex({
    dir: accountsWiring.codexDir(),
    ...(headless ? { onCode: (code: string, url: string) => void adding.set(agent, { name, url, code }) } : { onUrl: (url: string) => void adding.set(agent, { name, url }) }),
  })
  if (!signed.ok) return signed.error
  const folder = join(accountsWiring.codexDir(), signed.login)
  // The browser may have been signed in to an account on the list already: that one is not added twice.
  if (signed.who.key !== undefined && (await codexKeys()).includes(signed.who.key)) {
    await rm(folder, { recursive: true, force: true })
    return 'That account is on the list already. If the browser was signed in to it, copy the link into a private window and sign in to the other account there.'
  }
  try {
    addAccount(name, signed.login, path, new Date(accountsWiring.now()))
  } catch (err) {
    await rm(folder, { recursive: true, force: true })
    throw err
  }
  return undefined
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
  const refused = await nameTaken(agent, name)
  if (refused) return { ok: false, error: refused }
  const said = name.trim()
  adding.set(agent, { name: said })
  failed.delete(agent)
  void signIn(agent, said)
    .then(error => {
      if (error !== undefined) failed.set(agent, error)
    })
    .catch((err: unknown) => {
      failed.set(agent, err instanceof Error ? err.message : String(err))
    })
    .finally(() => {
      adding.delete(agent)
    })
  return { ok: true }
}

/** Hand Claude Code the code its page showed the person, on a computer with no browser of its own. */
export async function sendAgentAccountCode(agent: AccountsAgent, code: string): Promise<AccountResult> {
  const paste = pastes.get(agent)
  if (!paste) return { ok: false, error: 'No login waits for a code: start it again.' }
  return typeof code === 'string' && paste(code) ? { ok: true } : { ok: false, error: 'That is not the code the page shows: copy it whole, and paste it here.' }
}

/**
 * Remove an added account. A Claude login is not ended: it is good until its year is over, or until
 * it is taken back on claude.ai. A Codex account's folder, its login in it, goes with it.
 */
export async function sendRemoveAgentAccount(agent: AccountsAgent, name: string): Promise<AccountResult> {
  const gone = readAccounts(accountsWiring.path(agent)).find(a => a.name === name && a.login !== undefined)
  const done = change(() => removeAccount(name, accountsWiring.path(agent)))
  if (done.ok && gone && agent === 'codex') await rm(accountsWiring.codexFolder(gone), { recursive: true, force: true })
  return done
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

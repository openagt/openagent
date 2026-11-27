import { readFileSync } from 'node:fs'
import { configFile, writePrivate } from '../private-files.js'
import { ownedFor, ownerOf, ownsIt, type AgentAccount, type DriverRateWindow, type TeamCaller } from '@openagt/hooks'

// The accounts an agent's runs may use, when a person has more than one: their own login, which the
// agent keeps where it always does, and the ones added beside it. What an added account's login is,
// and how a turn runs on it, is the agent's own (`RunAgent.accounts`, and its driver): the list,
// its order, and the next free one taking over at a limit are the same for all. The person's
// terminal never changes account.
//
// One file per list and user, beside OpenAgent's own registry, readable by that user only: it may
// hold logins. The runner, the scheduler and the dashboard read it, and only through here. A driver knows none of this: it is handed the rotation (`rotation.ts`).

/** How long an account that hit a limit without saying when it frees is left alone. */
const UNSAID_LIMIT_MS = 5 * 60 * 60_000

/** The file: the accounts in the order runs try them. The person's own is the one with no login. */
interface AccountsFile {
  accounts: AgentAccount[]
}

/** The name the person's own login goes by until they give it one. */
export const OWN_NAME = 'This computer'

/** Where a list's file is: `$XDG_CONFIG_HOME/openagent-<list>-accounts.json`, else dotted under the home. */
export function accountsPath(list: string, env: NodeJS.ProcessEnv = process.env): string {
  return configFile(`openagent-${list}-accounts.json`, env)
}

/**
 * The accounts, in order, the person's own always among them: first when the file does not say
 * otherwise. The person's own is the one with no login, and there is one: another with none is no
 * account a run can use, and is left out.
 */
export function readAccounts(path: string): AgentAccount[] {
  let accounts: AgentAccount[] = []
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as Partial<AccountsFile>
    if (Array.isArray(file.accounts)) accounts = file.accounts.filter(isAccount)
  } catch {
    // No file yet, or one that does not read: the person's own login alone.
  }
  const own = accounts.find(a => a.login === undefined)
  return own ? accounts.filter(a => a.login !== undefined || a === own) : [{ name: OWN_NAME }, ...accounts]
}

function isAccount(value: unknown): value is AgentAccount {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  return typeof a['name'] === 'string' && (a['login'] === undefined || typeof a['login'] === 'string') && (a['accountId'] === undefined || typeof a['accountId'] === 'string')
}

/** The file as `change` leaves the accounts read now: written whole, then moved over the old one. */
export function changeAccounts(change: (accounts: AgentAccount[]) => AgentAccount[], path: string): AgentAccount[] {
  const accounts = change(readAccounts(path))
  writePrivate(path, `${JSON.stringify({ accounts } satisfies AccountsFile, null, 2)}\n`)
  return accounts
}

/** Why `name` cannot name an account: empty, or another account has it. */
export function nameRefused(name: string, accounts: AgentAccount[]): string | undefined {
  const said = name.trim()
  if (said === '') return 'An account needs a name.'
  if (accounts.some(a => a.name.toLowerCase() === said.toLowerCase())) return `There is an account named ${said} already.`
  return undefined
}

/** An added account, last in the order, with who it is when that is known, and whose (`owner`, on a machine shared by a team). Refused when the name is taken or empty. */
export function addAccount(name: string, login: string, path: string, now: Date = new Date(), accountId?: string, owner?: string): AgentAccount[] {
  return changeAccounts(accounts => {
    const refused = nameRefused(name, accounts)
    if (refused) throw new Error(refused)
    return [...accounts, { name: name.trim(), login: login.trim(), ...(accountId !== undefined ? { accountId } : {}), added: now.toISOString(), ...(owner !== undefined ? { owner } : {}) }]
  }, path)
}

/** The added account named `name` with a new login: signed in to again, it keeps its place and its name. */
export function replaceLogin(name: string, login: string, path: string): AgentAccount[] {
  return changeAccounts(
    accounts =>
      accounts.map(a =>
        a.name === name && a.login !== undefined
          ? { name: a.name, login: login.trim(), ...(a.added !== undefined ? { added: a.added } : {}), ...(a.owner !== undefined ? { owner: a.owner } : {}), ...(a.shared ? { shared: a.shared } : {}) }
          : a,
      ),
    path,
  )
}

/** The accounts without the added one named `name`. The person's own cannot be removed: the agent has it. */
export function removeAccount(name: string, path: string): AgentAccount[] {
  return changeAccounts(accounts => accounts.filter(a => a.name !== name || a.login === undefined), path)
}

/** The person's own login under the name they give it. */
export function nameOwnAccount(name: string, path: string): AgentAccount[] {
  return changeAccounts(accounts => {
    const refused = nameRefused(
      name,
      accounts.filter(a => a.login !== undefined),
    )
    if (refused) throw new Error(refused)
    return accounts.map(a => (a.login === undefined ? { ...a, name: name.trim() } : a))
  }, path)
}

/** The account named `name` first: the one runs try first from now on. */
export function useFirst(name: string, path: string): AgentAccount[] {
  return changeAccounts(accounts => {
    const picked = accounts.find(a => a.name === name)
    return picked ? [picked, ...accounts.filter(a => a !== picked)] : accounts
  }, path)
}

/** Whether a limit keeps the account out now. */
export function isLimited(account: AgentAccount, now: number): boolean {
  return account.limitedUntil !== undefined && account.limitedUntil > now
}

/**
 * The accounts that have a login: the person's own is on the list whether or not the agent has one,
 * and an added one whose login is gone (`addedThere`) too, and a run on one it does not have dies
 * at once, while the next account is free. With no account that has one the list stays: the run
 * says what is wrong.
 */
export function withLogin(accounts: AgentAccount[], ownThere: boolean, addedThere: (account: AgentAccount) => boolean = () => true): AgentAccount[] {
  const there = accounts.filter(a => (a.login === undefined ? ownThere : addedThere(a)))
  return there.length > 0 ? there : accounts
}

/** The accounts a project's runs may use, by name, in the file's order; all of them when it names none, or none that is still there. */
export function usableAccounts(accounts: AgentAccount[], only: readonly string[] | undefined): AgentAccount[] {
  if (only === undefined) return accounts
  const kept = accounts.filter(a => only.includes(a.name))
  return kept.length > 0 ? kept : accounts
}

/** The account a run uses: `prefer` when it is free, else the first free one in the order. None when every one is at a limit. */
export function pickAccount(accounts: AgentAccount[], now: number, prefer?: string): AgentAccount | undefined {
  const preferred = prefer !== undefined ? accounts.find(a => a.name === prefer && !isLimited(a, now)) : undefined
  return preferred ?? accounts.find(a => !isLimited(a, now))
}

/** The accounts with `name` kept out until `until`, or for a few hours when the limit said no time. */
export function markLimited(name: string, until: number | undefined, now: number, path: string): AgentAccount[] {
  return changeAccounts(accounts => accounts.map(a => (a.name === name ? { ...a, limitedUntil: until !== undefined && until > now ? until : now + UNSAID_LIMIT_MS } : a)), path)
}

/** The accounts with `name`'s windows as a turn just said them. */
export function noteWindows(name: string, windows: DriverRateWindow[], now: number, path: string): AgentAccount[] {
  return changeAccounts(accounts => accounts.map(a => (a.name === name ? { ...a, windows, windowsAt: now } : a)), path)
}

/** How long until `until`, in words: "3 h 20 min", "12 min", "less than a minute". */
export function freesIn(until: number, now: number): string {
  const minutes = Math.ceil((until - now) / 60_000)
  if (minutes < 1) return 'less than a minute'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/**
 * The accounts as a page shows them: everything but the logins. On a machine shared by a team,
 * only the caller's and the shared ones, each saying whose it is (`of`) and whether the caller
 * may change it (`mine`).
 */
export type ShownAccount = Omit<AgentAccount, 'login'> & { own: boolean; of?: string; mine?: boolean }

export function shownAccounts(accounts: AgentAccount[], caller?: TeamCaller): ShownAccount[] {
  return accounts
    .filter(a => ownedFor(caller, a))
    .map(({ login, ...rest }) => ({ ...rest, own: login === undefined, ...(caller ? { of: ownerOf(caller, rest), mine: ownsIt(caller, rest) } : {}) }))
}

/** The account named `name` shared with the team, or not. Only its owner shares it. */
export function shareAccount(name: string, shared: boolean, caller: TeamCaller, path: string): AgentAccount[] {
  return changeAccounts(accounts => {
    const account = accounts.find(a => a.name === name)
    if (!account || !ownsIt(caller, account)) throw new Error(`There is no account of yours named ${name}.`)
    return accounts.map(a => {
      if (a !== account) return a
      const { shared: _was, ...rest } = a
      return shared ? { ...rest, shared: true as const } : rest
    })
  }, path)
}

/** The accounts a run started for `caller` may use: theirs and the shared ones. All of them, with no caller. */
export function accountsFor(accounts: AgentAccount[], caller: TeamCaller | undefined): AgentAccount[] {
  return accounts.filter(a => ownedFor(caller, a))
}

/** Whether the person added an account to `list` beside the login its agent keeps. */
export function hasAddedAccount(list: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return readAccounts(accountsPath(list, env)).some(account => account.login !== undefined)
}

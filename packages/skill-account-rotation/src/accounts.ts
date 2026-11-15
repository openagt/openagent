import { readFileSync } from 'node:fs'
import type { AgentAccount, DriverRateWindow } from '@openagt/agent-driver'
import { configFile, writePrivate } from './files.js'

// The accounts an agent's runs may use, when a person has more than one: their own login, which the
// agent keeps where it always does, and the ones added beside it. What an added account's login is,
// and how a turn runs on it, is the agent's own (a login in the turn's environment, a home folder of
// its own): the list, its order, and the next free one taking over at a limit are the same for all.
// The person's terminal never changes account.
//
// One file per agent and user, beside OpenAgent's own registry, readable by that user only: it may
// hold logins. The runner, the scheduler, the dashboard and a server's install read it, and only
// through here. A driver knows none of this: it is handed the rotation (`rotation.ts`).

/** How long an account that hit a limit without saying when it frees is left alone. */
const UNSAID_LIMIT_MS = 5 * 60 * 60_000

/** The file: the accounts in the order runs try them. The person's own is the one with no login. */
interface AccountsFile {
  accounts: AgentAccount[]
}

/** The name the person's own login goes by until they give it one. */
export const OWN_NAME = 'This computer'

/** The agents with accounts. */
export type AccountsAgent = 'claude' | 'codex'

/** Where an agent's file is: `$XDG_CONFIG_HOME/openagent-<agent>-accounts.json`, else dotted under the home. */
export function accountsPath(agent: AccountsAgent, env: NodeJS.ProcessEnv = process.env): string {
  return configFile(`openagent-${agent}-accounts.json`, env)
}

/** Where a server keeps what it knows of the logins the person's computers handed it, never a login: OpenAgent writes it, beside the accounts. */
export function copiedPath(env: NodeJS.ProcessEnv = process.env): string {
  return configFile('openagent-copied-logins.json', env)
}

/** Where an account a computer of the person's handed to this server came from. */
export interface HandedOver {
  from: string
  /** Taken off here it is handed over again at once: a Claude account added there goes as it is. Any other waits for the person's press there. */
  comesBack: boolean
}

function readHandedOver(env: NodeJS.ProcessEnv): unknown[] {
  try {
    const logins = (JSON.parse(readFileSync(copiedPath(env), 'utf8')) as { logins?: unknown }).logins
    return Array.isArray(logins) ? logins : []
  } catch {
    return []
  }
}

/** An agent's accounts a computer handed over, by the account's name. None but on a server that uses a computer's logins. */
export function handedOverBy(agent: AccountsAgent, env: NodeJS.ProcessEnv = process.env): Map<string, HandedOver> {
  const entries = (readHandedOver(env) as { kind?: unknown; name?: unknown; from?: unknown; source?: unknown }[]).flatMap(login =>
    login?.kind === agent && typeof login.name === 'string' && typeof login.from === 'string' ? [[login.name, { from: login.from, comesBack: agent === 'claude' && login.source !== 'own' }] as const] : [],
  )
  return new Map(entries)
}

/** The account is no longer here: the computer that handed it over offers it again. */
export function forgetHandedOver(agent: AccountsAgent, name: string, env: NodeJS.ProcessEnv = process.env): void {
  const logins = readHandedOver(env) as { kind?: unknown; name?: unknown }[]
  const left = logins.filter(login => login?.kind !== agent || login.name !== name)
  if (left.length === logins.length) return
  writePrivate(copiedPath(env), `${JSON.stringify({ logins: left }, null, 2)}\n`)
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

/** An added account, last in the order, with who it is when that is known. Refused when the name is taken or empty. */
export function addAccount(name: string, login: string, path: string, now: Date = new Date(), accountId?: string): AgentAccount[] {
  return changeAccounts(accounts => {
    const refused = nameRefused(name, accounts)
    if (refused) throw new Error(refused)
    return [...accounts, { name: name.trim(), login: login.trim(), ...(accountId !== undefined ? { accountId } : {}), added: now.toISOString() }]
  }, path)
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
 * and a run on one it does not have dies at once, while the next account is free. With no other
 * account the list stays: the run says what is wrong.
 */
export function withLogin(accounts: AgentAccount[], ownThere: boolean): AgentAccount[] {
  if (ownThere) return accounts
  const added = accounts.filter(a => a.login !== undefined)
  return added.length > 0 ? added : accounts
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

/** The accounts as a page shows them: everything but the logins. */
export type ShownAccount = Omit<AgentAccount, 'login'> & { own: boolean }

export function shownAccounts(accounts: AgentAccount[]): ShownAccount[] {
  return accounts.map(({ login, ...rest }) => ({ ...rest, own: login === undefined }))
}

/** Whether the person added an account of `agent` beside the login its CLI keeps. */
export function hasAddedAccount(agent: AccountsAgent, env: NodeJS.ProcessEnv = process.env): boolean {
  return readAccounts(accountsPath(agent, env)).some(account => account.login !== undefined)
}

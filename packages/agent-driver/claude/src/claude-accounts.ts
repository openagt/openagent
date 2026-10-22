import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DriverRateWindow } from '@openagt/agent-driver'

// The Claude accounts runs may use, when a person has more than one: their own login, which Claude
// Code keeps (the Mac's Keychain, a server's login file), and the ones added beside it, each a
// login Claude Code made for a computer nobody sits at (`claude setup-token`). A turn on an added
// account has its login in the turn's environment alone, where Claude Code reads it before its own:
// the person's terminal never changes account.
//
// One file per user, beside OpenAgent's own registry, readable by that user only: it holds logins.
// The runner, the scheduler, the dashboard and a server's install read it, and only through here.

/** The name Claude Code reads a login under that was made for a computer nobody sits at. */
export const CLAUDE_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'

/** How long an account that hit a limit without saying when it frees is left alone. */
const UNSAID_LIMIT_MS = 5 * 60 * 60_000

/** One account as the file keeps it. */
export interface ClaudeAccount {
  /** Its name, as the person gave it; unique. The person's own login has none until they give one. */
  name: string
  /** The login, for an added account. None for the person's own: Claude Code has that one. */
  token?: string
  /** When it was added, ISO 8601. */
  added?: string
  /** When a limit it hit frees, epoch milliseconds: until then no run picks it. */
  limitedUntil?: number
  /** Its windows as the last turn on it said them. */
  windows?: DriverRateWindow[]
  /** When those were said, epoch milliseconds. */
  windowsAt?: number
}

/** The file: the accounts in the order runs try them. The person's own is the one with no token. */
interface AccountsFile {
  accounts: ClaudeAccount[]
}

/** The name the person's own login goes by until they give it one. */
export const OWN_NAME = 'This computer'

/** Where the file is: `$XDG_CONFIG_HOME/openagent-claude-accounts.json`, else dotted under the home. */
export function accountsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env['XDG_CONFIG_HOME']) return join(env['XDG_CONFIG_HOME'], 'openagent-claude-accounts.json')
  return join(env['HOME'] ?? homedir(), '.openagent-claude-accounts.json')
}

/** The accounts, in order, the person's own always among them: first when the file does not say otherwise. */
export function readAccounts(path: string = accountsPath()): ClaudeAccount[] {
  let accounts: ClaudeAccount[] = []
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as Partial<AccountsFile>
    if (Array.isArray(file.accounts)) accounts = file.accounts.filter(isAccount)
  } catch {
    // No file yet, or one that does not read: the person's own login alone.
  }
  return accounts.some(a => a.token === undefined) ? accounts : [{ name: OWN_NAME }, ...accounts]
}

function isAccount(value: unknown): value is ClaudeAccount {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  return typeof a['name'] === 'string' && (a['token'] === undefined || typeof a['token'] === 'string')
}

/** The file as `change` leaves the accounts read now: written whole, then moved over the old one. */
export function changeAccounts(change: (accounts: ClaudeAccount[]) => ClaudeAccount[], path: string = accountsPath()): ClaudeAccount[] {
  const accounts = change(readAccounts(path))
  mkdirSync(dirname(path), { recursive: true })
  const next = `${path}.${process.pid}.new`
  writeFileSync(next, `${JSON.stringify({ accounts } satisfies AccountsFile, null, 2)}\n`, { mode: 0o600 })
  chmodSync(next, 0o600)
  renameSync(next, path)
  return accounts
}

/** An added account, last in the order. Refused when the name is taken or empty. */
export function addAccount(name: string, token: string, path?: string, now: Date = new Date()): ClaudeAccount[] {
  const said = name.trim()
  if (said === '') throw new Error('An account needs a name.')
  return changeAccounts(accounts => {
    if (accounts.some(a => a.name.toLowerCase() === said.toLowerCase())) throw new Error(`There is an account named ${said} already.`)
    return [...accounts, { name: said, token: token.trim(), added: now.toISOString() }]
  }, path)
}

/** The accounts without the added one named `name`. The person's own cannot be removed: Claude Code has it. */
export function removeAccount(name: string, path?: string): ClaudeAccount[] {
  return changeAccounts(accounts => accounts.filter(a => a.name !== name || a.token === undefined), path)
}

/** The person's own login under the name they give it. */
export function nameOwnAccount(name: string, path?: string): ClaudeAccount[] {
  const said = name.trim()
  if (said === '') throw new Error('An account needs a name.')
  return changeAccounts(accounts => {
    if (accounts.some(a => a.token !== undefined && a.name.toLowerCase() === said.toLowerCase())) throw new Error(`There is an account named ${said} already.`)
    return accounts.map(a => (a.token === undefined ? { ...a, name: said } : a))
  }, path)
}

/** The account named `name` first: the one runs try first from now on. */
export function useFirst(name: string, path?: string): ClaudeAccount[] {
  return changeAccounts(accounts => {
    const picked = accounts.find(a => a.name === name)
    return picked ? [picked, ...accounts.filter(a => a !== picked)] : accounts
  }, path)
}

/** Whether a limit keeps the account out now. */
export function isLimited(account: ClaudeAccount, now: number): boolean {
  return account.limitedUntil !== undefined && account.limitedUntil > now
}

/** The account a run uses: `prefer` when it is free, else the first free one in the order. None when every one is at a limit. */
export function pickAccount(accounts: ClaudeAccount[], now: number, prefer?: string): ClaudeAccount | undefined {
  const preferred = prefer !== undefined ? accounts.find(a => a.name === prefer && !isLimited(a, now)) : undefined
  return preferred ?? accounts.find(a => !isLimited(a, now))
}

/** The accounts with `name` kept out until `until`, or for a few hours when the limit said no time. */
export function markLimited(name: string, until: number | undefined, now: number, path?: string): ClaudeAccount[] {
  return changeAccounts(accounts => accounts.map(a => (a.name === name ? { ...a, limitedUntil: until !== undefined && until > now ? until : now + UNSAID_LIMIT_MS } : a)), path)
}

/** The accounts with `name`'s windows as a turn just said them. */
export function noteWindows(name: string, windows: DriverRateWindow[], now: number, path?: string): ClaudeAccount[] {
  return changeAccounts(accounts => accounts.map(a => (a.name === name ? { ...a, windows, windowsAt: now } : a)), path)
}

/** The environment a turn on `account` runs with: an added account's login in it, the person's own as Claude Code keeps it. */
export function accountEnv(account: ClaudeAccount, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return account.token !== undefined ? { ...env, [CLAUDE_TOKEN_ENV]: account.token } : env
}

/** How long until `until`, in words: "3 h 20 min", "12 min", "less than a minute". */
export function freesIn(until: number, now: number): string {
  const minutes = Math.ceil((until - now) / 60_000)
  if (minutes < 1) return 'less than a minute'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** The accounts as a page shows them: everything but the logins. */
export type ShownAccount = Omit<ClaudeAccount, 'token'> & { own: boolean }

export function shownAccounts(accounts: ClaudeAccount[]): ShownAccount[] {
  return accounts.map(({ token, ...rest }) => ({ ...rest, own: token === undefined }))
}

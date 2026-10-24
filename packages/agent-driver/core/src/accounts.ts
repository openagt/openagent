import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DriverEvent, DriverPromptOptions, DriverRateWindow, DriverTurn } from './types.js'

// The accounts an agent's runs may use, when a person has more than one: their own login, which the
// agent keeps where it always does, and the ones added beside it. What an added account's login is,
// and how a turn runs on it, is the agent's own (a login in the turn's environment, a home folder of
// its own): the list, its order, and the next free one taking over at a limit are the same for all.
// The person's terminal never changes account.
//
// One file per agent and user, beside OpenAgent's own registry, readable by that user only: it may
// hold logins. The runner, the scheduler, the dashboard and a server's install read it, and only
// through here.

/** How long an account that hit a limit without saying when it frees is left alone. */
const UNSAID_LIMIT_MS = 5 * 60 * 60_000

/** One account as the file keeps it. */
export interface AgentAccount {
  /** Its name, as the person gave it; unique. The person's own login has none until they give one. */
  name: string
  /** An added account's login, as its agent keeps it. None for the person's own: the agent has that one. */
  login?: string
  /** When it was added, ISO 8601. */
  added?: string
  /** When a limit it hit frees, epoch milliseconds: until then no run picks it. */
  limitedUntil?: number
  /** Its windows as the last turn on it said them. */
  windows?: DriverRateWindow[]
  /** When those were said, epoch milliseconds. */
  windowsAt?: number
}

/** The file: the accounts in the order runs try them. The person's own is the one with no login. */
interface AccountsFile {
  accounts: AgentAccount[]
}

/** The name the person's own login goes by until they give it one. */
export const OWN_NAME = 'This computer'

/** Where an agent's file is: `$XDG_CONFIG_HOME/openagent-<agent>-accounts.json`, else dotted under the home. */
export function accountsPath(agent: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env['XDG_CONFIG_HOME']) return join(env['XDG_CONFIG_HOME'], `openagent-${agent}-accounts.json`)
  return join(env['HOME'] ?? homedir(), `.openagent-${agent}-accounts.json`)
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
  return typeof a['name'] === 'string' && (a['login'] === undefined || typeof a['login'] === 'string')
}

/** The file as `change` leaves the accounts read now: written whole, then moved over the old one. */
export function changeAccounts(change: (accounts: AgentAccount[]) => AgentAccount[], path: string): AgentAccount[] {
  const accounts = change(readAccounts(path))
  mkdirSync(dirname(path), { recursive: true })
  const next = `${path}.${process.pid}.new`
  writeFileSync(next, `${JSON.stringify({ accounts } satisfies AccountsFile, null, 2)}\n`, { mode: 0o600 })
  chmodSync(next, 0o600)
  renameSync(next, path)
  return accounts
}

/** Why `name` cannot name an account: empty, or another account has it. */
export function nameRefused(name: string, accounts: AgentAccount[]): string | undefined {
  const said = name.trim()
  if (said === '') return 'An account needs a name.'
  if (accounts.some(a => a.name.toLowerCase() === said.toLowerCase())) return `There is an account named ${said} already.`
  return undefined
}

/** An added account, last in the order. Refused when the name is taken or empty. */
export function addAccount(name: string, login: string, path: string, now: Date = new Date()): AgentAccount[] {
  return changeAccounts(accounts => {
    const refused = nameRefused(name, accounts)
    if (refused) throw new Error(refused)
    return [...accounts, { name: name.trim(), login: login.trim(), added: now.toISOString() }]
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

/** Which accounts file a session runs on, and the account it starts on when that one is free. */
export interface AccountsOption {
  /** The file. Default the agent's own {@link accountsPath} in the session's environment. */
  path?: string
  /** The account to start on, by name: a scheduler's pick. Else the first free one. */
  prefer?: string
  /** The accounts this session may use, by name, in the file's order: a project's own few. All of them when unsaid, or when none of these is there any more. */
  only?: readonly string[]
  /** The clock, for tests. */
  now?: () => number
}

/** Every account the session may use is at its limit: the turn cannot go on. */
export class UsageLimitError extends Error {
  override readonly name = 'UsageLimitError'
}

/** What the next account is told after a switch: the prompt is in the conversation already. */
export function goOn(agent: string): string {
  return `A usage limit stopped you. The work goes on now on another ${agent} account: continue where you stopped.`
}

/** What one turn on one account came to, as its agent read it. */
export interface AccountTurn {
  /** The turn, when it ended with one. */
  turn?: DriverTurn
  /** What it threw, when it did. */
  failure?: unknown
  /** Whether the account's limit is what stopped it. */
  limited: boolean
  /** When that limit frees, epoch ms, when the agent said. */
  resetsAt?: number
  /** The account's windows as the turn said them. */
  windows?: DriverRateWindow[]
  /** The conversation, so far as the turn got: what the next account continues. */
  sessionId?: string
}

/** What {@link turnOnAccounts} runs a turn with. */
export interface TurnOnAccounts {
  option: AccountsOption
  /** The file. */
  path: string
  /** The agent's name as a person reads it: "Claude", "Codex". */
  agent: string
  /** The account the session is on, kept across its turns until a limit moves it on. */
  current: { account?: string }
  text: string
  opts: DriverPromptOptions
  emit: (event: DriverEvent) => void
  /** Whether the session or the turn was stopped: a stop is never a limit to switch over. */
  stopped: () => boolean
  /** The conversation the next account continues. */
  continueFrom: (sessionId: string) => void
  /** One turn on `account`: the person's own login, as the agent keeps it, when the account has none. */
  run: (account: AgentAccount, said: string, sent: DriverPromptOptions) => Promise<AccountTurn>
}

/** Why no account can take the turn: each is at its limit, and the first to free says when. */
function allLimited(accounts: AgentAccount[], agent: string, now: number): string {
  const first = accounts.filter(a => a.limitedUntil !== undefined).sort((a, b) => a.limitedUntil! - b.limitedUntil!)[0]
  const count = accounts.length === 1 ? `The ${agent} account is` : `All ${accounts.length} ${agent} accounts are`
  return `${count} at their limit${first?.limitedUntil !== undefined ? `: ${first.name}'s is free again in ${freesIn(first.limitedUntil, now)}` : ''}.`
}

/**
 * A turn on the person's accounts: on the one the session is on, or the first free one. The
 * account's windows are kept as the turn says them; a turn its account's limit stops marks the
 * account limited until it frees, and the same conversation goes on with the next free account,
 * told to go on where it stopped. Every account at its limit ends the turn. One account is no
 * choice: the turn tries it, as one always did, whatever a limit said of it before.
 */
export async function turnOnAccounts(on: TurnOnAccounts): Promise<DriverTurn> {
  const now = on.option.now ?? Date.now
  const usable = (all: AgentAccount[]): AgentAccount[] => usableAccounts(all, on.option.only)
  const ended = (result: AccountTurn): DriverTurn => {
    if (result.turn === undefined) throw result.failure
    return result.turn
  }
  const first = usable(readAccounts(on.path))
  if (first.length < 2) return ended(await on.run(first[0]!, on.text, on.opts))
  let said = on.text
  let sent = on.opts
  for (;;) {
    const all = usable(readAccounts(on.path))
    const account = (on.current.account !== undefined ? all.find(a => a.name === on.current.account && !isLimited(a, now())) : undefined) ?? pickAccount(all, now(), on.option.prefer)
    if (account === undefined) throw new UsageLimitError(allLimited(all, on.agent, now()))
    on.current.account = account.name
    const result = await on.run(account, said, sent)
    if (result.windows) noteWindows(account.name, result.windows, now(), on.path)
    if (!result.limited || on.stopped()) return ended(result)
    const after = usable(markLimited(account.name, result.resetsAt, now(), on.path))
    const next = pickAccount(after, now())
    if (next === undefined) throw new UsageLimitError(allLimited(after, on.agent, now()))
    const frees = after.find(a => a.name === account.name)?.limitedUntil
    on.emit({ type: 'notice', message: `↻ Switched to ${next.name}'s ${on.agent}: ${account.name}'s hit its limit${frees !== undefined ? `, free again in ${freesIn(frees, now())}` : ''}.` })
    on.current.account = next.name
    if (result.sessionId !== undefined) on.continueFrom(result.sessionId)
    // The prompt is in the conversation already: the next account is told to go on with it, and
    // nothing of what went with it is handed over twice.
    const { attached: _attached, added: _added, inbox: _inbox, onInboxLine: _onInboxLine, ...rest } = on.opts
    said = goOn(on.agent)
    sent = { ...rest, resume: true }
  }
}

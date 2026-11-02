import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { type AgentAccount } from '@openagt/agent-driver'
import { codexWho } from '@openagt/agent-driver-codex'
import { isServerName } from '../dashboard/machine-logins.js'
import { isKind, isWord, readCopied, readUsage, same, writeCopied, type CopiedKind, type CopiedLogin, type GivenLogin, type UsageWindow } from '../dashboard/copied-logins.js'
import { accountsWiring, type AccountResult } from './accounts.js'
import { gitHostPackages } from './logins.js'
import { addAccount, changeAccounts, readAccounts, removeAccount } from '@openagt/skill-account-rotation'

// What a server answers the person's own computers about their logins here (the logins, and what
// is kept of them: `dashboard/copied-logins.ts`): what it keeps, a login handed over, one taken
// off or kept, how full each is. Only a server's OpenAgent takes logins.
//
// Taking one off deletes it here and ends nothing: the computer goes on logged in.

/** What the RPCs reach for, swapped in tests. */
export const copiedWiring: {
  /** Whether this OpenAgent is a server's: only a server takes logins. */
  server: () => boolean
  /** Where a Codex account's sign-in is kept, a folder each. */
  codexDir: () => string
  /** Run a git host's package command for `host`, with `input` on its standard input. */
  gitHost: (host: string, args: string[], input?: string) => Promise<{ ok: true; output: unknown } | { ok: false; error: string }>
} = {
  server: () => process.env['OPENAGENT_SERVER'] === '1',
  codexDir: () => accountsWiring.codexDir(),
  gitHost: (host, args, input) => gitHostPackages.run(host, args, input),
}

/** What the server says it keeps, to the computer that asks. */
export type CopiedView = { ok: true; logins: Omit<CopiedLogin, 'usage'>[] } | { ok: false; error: string }

function refused(): { ok: false; error: string } {
  return { ok: false, error: 'This OpenAgent takes no logins from another computer: it is no server.' }
}

/** What the server keeps from the person's computers, without how full each is: what a computer compares its own with. */
export async function onCopiedLogins(): Promise<CopiedView> {
  if (!copiedWiring.server()) return refused()
  return { ok: true, logins: readCopied().map(({ usage: _usage, ...rest }) => rest) }
}

/** A name for the row that no other account here has: the computer's name beside it when one has it already. */
function freeName(name: string, from: string, accounts: AgentAccount[]): string {
  const taken = (candidate: string): boolean => accounts.some(a => a.name.toLowerCase() === candidate.toLowerCase())
  if (!taken(name)) return name
  const beside = `${name} (${from})`
  for (let n = 2; ; n++) {
    const candidate = n === 2 ? beside : `${beside} ${n}`
    if (!taken(candidate)) return candidate
  }
}

/** The account rows here a copied login has, by its kind: one of a coding agent's accounts, or a git host's account. */
async function takeOff(login: CopiedLogin): Promise<AccountResult> {
  if (login.kind === 'git') {
    const gone = await copiedWiring.gitHost(login.host!, ['forget', login.name])
    return gone.ok ? { ok: true } : gone
  }
  const path = accountsWiring.path(login.kind)
  const account = readAccounts(path).find(a => a.name === login.name && a.login !== undefined)
  removeAccount(login.name, path)
  if (account && login.kind === 'codex') await rm(join(copiedWiring.codexDir(), account.login!), { recursive: true, force: true })
  return { ok: true }
}

/**
 * The added accounts runs take first: on a server the person's own computers' logins lead, and
 * its own login, which a server mostly has none of, comes last.
 */
function ownLast(path: string): void {
  changeAccounts(accounts => [...accounts.filter(a => a.login !== undefined), ...accounts.filter(a => a.login === undefined)], path)
}

/** A Codex account's sign-in, as Codex keeps it, in a folder of its own: Codex renews it there. */
async function codexFolder(auth: string): Promise<{ ok: true; folder: string; key?: string } | { ok: false; error: string }> {
  try {
    JSON.parse(auth)
  } catch {
    return { ok: false, error: 'What was handed over is no Codex sign-in.' }
  }
  const folder = `codex-${randomBytes(6).toString('hex')}`
  const dir = join(copiedWiring.codexDir(), folder)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  await writeFile(join(dir, 'auth.json'), auth, { mode: 0o600 })
  const who = await codexWho(dir)
  if (who.key === undefined) {
    await rm(dir, { recursive: true, force: true })
    return { ok: false, error: 'What was handed over is no Codex sign-in.' }
  }
  return { ok: true, folder, key: who.key }
}

/**
 * Take a login a computer of the person's handed over: it goes where its tool reads it, in place
 * of what the same account of the same computer had here before. `secret` is the login: a
 * Claude login, a Codex sign-in as Codex keeps it, a git host's token.
 */
export async function sendCopiedLogin(given: GivenLogin, secret: string): Promise<AccountResult> {
  if (!copiedWiring.server()) return refused()
  const { kind, host, source, name, who, from } = (given ?? {}) as Partial<GivenLogin>
  if (!isKind(kind) || !isWord(source) || !isWord(name) || !isWord(who) || !isServerName(from) || (kind === 'git' && !isWord(host)) || typeof secret !== 'string' || !secret.trim() || secret.length > 64 * 1024) {
    return { ok: false, error: 'That is no login.' }
  }
  const login: CopiedLogin = { kind, ...(kind === 'git' ? { host: host! } : {}), source, name, who, from, ...(kind === 'git' && given.runs === true ? { runs: true as const } : {}) }
  const before = readCopied().find(other => same(other, login))
  if (before) {
    const gone = await takeOff(before)
    if (!gone.ok) return gone
    writeCopied(readCopied().filter(other => !same(other, login)))
  }
  if (kind === 'git') {
    const taken = await copiedWiring.gitHost(host!, ['take'], secret.trim())
    if (!taken.ok) return taken
    const account = (taken.output as { login?: unknown } | null)?.login
    if (typeof account !== 'string' || account.toLowerCase() !== name.toLowerCase()) {
      if (typeof account === 'string') await copiedWiring.gitHost(host!, ['forget', account])
      return { ok: false, error: `The token handed over for ${name} is ${typeof account === 'string' ? `${account}'s` : 'no account\'s'} at ${host}.` }
    }
    if (login.runs) await copiedWiring.gitHost(host!, ['use', name])
  } else {
    const path = accountsWiring.path(kind)
    const row = freeName(name, from, readAccounts(path))
    let kept = secret.trim()
    if (kind === 'codex') {
      const made = await codexFolder(secret)
      if (!made.ok) return made
      kept = made.folder
    }
    addAccount(row, kept, path, new Date(accountsWiring.now()), kind === 'claude' ? claudeAccountId(who) : undefined)
    ownLast(path)
    login.name = row
  }
  writeCopied([...readCopied().filter(other => !same(other, login)), login])
  return { ok: true }
}

/**
 * Who a Claude login is at Claude, from what the computer said of it: the person's own login is
 * said by its account's id when Claude Code there knows it (`claudeOwnAccount`), which Claude Code
 * here needs beside the login to offer what the account may use. An added account is said by a
 * mark of its login, which is no id.
 */
function claudeAccountId(who: string): string | undefined {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(who) ? who : undefined
}

/** Take a login a computer handed over off this server: it is deleted here, and goes on working wherever else it is. */
export async function sendForgetCopiedLogin(which: Pick<CopiedLogin, 'kind' | 'host' | 'source'>): Promise<AccountResult> {
  if (!copiedWiring.server()) return refused()
  const login = readCopied().find(other => isKind(which?.kind) && same(other, which))
  if (!login) return { ok: true }
  const gone = await takeOff(login)
  if (!gone.ok) return gone
  writeCopied(readCopied().filter(other => !same(other, login)))
  return { ok: true }
}

/**
 * Keep a login the computer no longer has: the person said to. It is no longer that account of the
 * computer's, so the computer's next login under the same account takes a place of its own.
 */
export async function sendKeepCopiedLogin(which: Pick<CopiedLogin, 'kind' | 'host' | 'source'>): Promise<AccountResult> {
  if (!copiedWiring.server()) return refused()
  const logins = readCopied()
  const login = logins.find(other => isKind(which?.kind) && same(other, which))
  if (!login) return { ok: false, error: 'That login is no longer on this server.' }
  writeCopied(logins.map(other => (other === login ? { ...other, source: `kept:${other.who}`, kept: true as const } : other)))
  return { ok: true }
}

/** How full each login is, as the computer read it: shown on this server's page, whose own reading a Claude login made for it cannot make. */
export async function sendCopiedUsage(readings: { kind: CopiedKind; host?: string; source: string; windows: UsageWindow[]; at: number }[]): Promise<AccountResult> {
  if (!copiedWiring.server()) return refused()
  if (!Array.isArray(readings)) return { ok: false, error: 'That is no reading.' }
  const logins = readCopied()
  let changed = false
  for (const reading of readings.slice(0, 64)) {
    const login = logins.find(other => isKind(reading?.kind) && same(other, reading))
    const usage = readUsage(reading)
    if (!login || !usage) continue
    login.usage = usage
    changed = true
  }
  if (changed) writeCopied(logins)
  return { ok: true }
}

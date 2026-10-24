import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isServerName } from './machine-logins.js'

// On a server, the logins of the person's own computers (`logins-sync.ts` is a computer's side).
// Each one is a login of the server's own, made by that computer for it and handed over through
// the server's door (`dashboard-rpc/copied-logins.ts`): a Claude login made for a computer nobody
// sits at, a Codex sign-in of its own, a git host's token as the computer's tool keeps it. Each
// goes where its tool reads it here, beside the logins made here, and this file keeps what the
// computer said of it: which of its accounts it is, whose, and how full it was when the computer
// last read it. Never a login.

/** One of an account's usage windows, as a page names it: `5 h`, `week`, `month`, and how much of it is gone. */
export interface UsageWindow {
  label: string
  percent: number
}

/** What a copied login is a login of: a coding agent's account, or a git host's. */
export type CopiedKind = 'claude' | 'codex' | 'git'

/** One login a computer of the person's handed over, as this server keeps it: never the login itself. */
export interface CopiedLogin {
  kind: CopiedKind
  /** A git host's account: the host. */
  host?: string
  /** Which of the computer's accounts it is: `own` for its own login, else the account's name there, or its login at the git host. */
  source: string
  /** The name of its row here. */
  name: string
  /** Who the account is, as the computer said when it handed it over: a switch to another account says another. */
  who: string
  /** The computer it came from, by its name. */
  from: string
  /** The computer no longer has it, and the person said to keep it here. */
  kept?: true
  /** A git host's account the computer's runs use: the server's do too. */
  runs?: true
  /** How full it is, as the computer last read it. */
  usage?: { windows: UsageWindow[]; at: number }
}

/** A login handed over: what it is, and the login itself, which goes where its tool reads it. */
export interface GivenLogin {
  kind: CopiedKind
  host?: string
  source: string
  name: string
  who: string
  from: string
  runs?: boolean
}

/** Where the file is: beside OpenAgent's other files in the person's config folder. */
export function copiedPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['XDG_CONFIG_HOME'] ? join(env['XDG_CONFIG_HOME'], 'openagent-copied-logins.json') : join(env['HOME'] ?? homedir(), '.openagent-copied-logins.json')
}

const KINDS: readonly string[] = ['claude', 'codex', 'git']
export const isKind = (value: unknown): value is CopiedKind => typeof value === 'string' && KINDS.includes(value)
/** A word a computer said: a name, an account, a host. Never long, never a line break. */
export const isWord = (value: unknown, max = 200): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= max && !/[\r\n\0]/.test(value)

function readOne(value: unknown): CopiedLogin | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { kind, host, source, name, who, from, kept, runs, usage } = value as Record<string, unknown>
  if (!isKind(kind) || !isWord(source) || !isWord(name) || !isWord(who) || !isServerName(from)) return undefined
  if (kind === 'git' && !isWord(host)) return undefined
  const read = readUsage(usage)
  return { kind, ...(kind === 'git' ? { host: host as string } : {}), source, name, who, from, ...(kept === true ? { kept: true as const } : {}), ...(runs === true ? { runs: true as const } : {}), ...(read ? { usage: read } : {}) }
}

export function readUsage(value: unknown): CopiedLogin['usage'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { windows, at } = value as Record<string, unknown>
  if (typeof at !== 'number' || !Array.isArray(windows)) return undefined
  const read = windows.flatMap(w => {
    const { label, percent } = (w ?? {}) as Record<string, unknown>
    return isWord(label, 20) && typeof percent === 'number' && percent >= 0 && percent <= 100 ? [{ label, percent }] : []
  })
  return { windows: read.slice(0, 4), at }
}

/** The logins this server keeps from the person's computers. Forgiving: none on a file that does not read. */
export function readCopied(): CopiedLogin[] {
  try {
    const file = JSON.parse(readFileSync(copiedPath(), 'utf8')) as { logins?: unknown }
    return Array.isArray(file.logins) ? file.logins.flatMap(entry => readOne(entry) ?? []) : []
  } catch {
    return []
  }
}

export function writeCopied(logins: CopiedLogin[]): void {
  const path = copiedPath()
  mkdirSync(dirname(path), { recursive: true })
  const next = `${path}.${process.pid}.new`
  writeFileSync(next, `${JSON.stringify({ logins }, null, 2)}\n`, { mode: 0o600 })
  chmodSync(next, 0o600)
  renameSync(next, path)
}

/** The same login of the same computer: its kind, its host, and which of the computer's accounts it is. */
export const same = (a: Pick<CopiedLogin, 'kind' | 'host' | 'source'>, b: Pick<CopiedLogin, 'kind' | 'host' | 'source'>): boolean => a.kind === b.kind && (a.host ?? '') === (b.host ?? '') && a.source === b.source

/** The copied login of an account row here, by its kind and its name. */
export function copiedOf(kind: CopiedKind, name: string, host?: string): CopiedLogin | undefined {
  return readCopied().find(login => login.kind === kind && login.name === name && (login.host ?? '') === (host ?? ''))
}


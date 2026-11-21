import { accountGit, nodeGitRunner, noAccountSentence, originUrl, readRemoteAccount, remoteHostOf, type GitRunner, type RemoteAccount } from '@openagt/agent-data'
import { typedRepository } from '../typed-repository.js'
import { gitHostPackages, onGitHosts } from './logins.js'

// The account OpenAgent sends a repository as (`remote-account.ts` in agent-data): one of its
// own accounts at the repository's host, named where the person turns sending on, never the
// person's own login. What the git host's package answers for an account (`<command> git-config
// --user <login>`) is what the repository keeps.

/** OpenAgent's accounts at one host: what a "Send as" select offers. */
export interface SendAsHost {
  host: string
  /** The logins GitHub still takes, by name. */
  logins: string[]
  /** The one runs use, picked first where none is named yet. */
  runs?: string
}

/** OpenAgent's accounts at each host a package answers for. */
export async function accountsByHost(): Promise<SendAsHost[]> {
  const { hosts } = await onGitHosts()
  return hosts.flatMap(row => {
    const accounts = row.provider?.accounts.filter(account => account.ok) ?? []
    if (accounts.length === 0) return []
    const runs = accounts.find(account => account.runs)?.login
    return [{ host: row.host, logins: accounts.map(account => account.login), ...(runs !== undefined ? { runs } : {}) }]
  })
}

/** How long what a host's package said of an account is kept: asking it checks every account with the host. */
const ACCOUNT_KEEP_MS = 5 * 60_000

const knownAccounts = new Map<string, { at: number; account: RemoteAccount }>()

/** What a repository at `host` keeps to be sent as `login`: what its git host's package says of that account, kept a few minutes. */
export async function remoteAccount(host: string, login?: string): Promise<{ ok: true; account: RemoteAccount } | { ok: false; error: string }> {
  if (login === undefined) return { ok: false, error: `${noAccountSentence(host)}: add one in Permissions › Git hosts.` }
  if (typeof login !== 'string' || !/^\S+$/.test(login)) return { ok: false, error: `${String(login)} is no account.` }
  const known = knownAccounts.get(`${host}\n${login}`)
  if (known && Date.now() - known.at < ACCOUNT_KEEP_MS) return { ok: true, account: known.account }
  const said = await gitHostPackages.run(host, ['git-config', '--user', login])
  if (!said.ok) return said
  const { login: as, host: at, config } = (said.output ?? {}) as { login?: unknown; host?: unknown; config?: unknown }
  const lines = Array.isArray(config) ? config.filter((line): line is [string, string] => Array.isArray(line) && line.length === 2 && typeof line[0] === 'string' && typeof line[1] === 'string') : []
  if (typeof as !== 'string' || typeof at !== 'string' || lines.length === 0) return { ok: false, error: `The package for ${host} gave no way to send as @${login}.` }
  const account = { login: as, host: at, config: lines }
  knownAccounts.set(`${host}\n${login}`, { at: Date.now(), account })
  return { ok: true, account }
}

/** The account a repository at a typed address is cloned as: the one runs use at its host; none where OpenAgent has none there. */
export async function cloneAccountFor(typed: string): Promise<RemoteAccount | undefined> {
  const host = typedRepository(typed)?.address.split('/')[0]
  if (host === undefined) return undefined
  const runs = (await accountsByHost().catch((): SendAsHost[] => [])).find(row => row.host === host)?.runs
  if (runs === undefined) return undefined
  const account = await remoteAccount(host, runs)
  return account.ok ? account.account : undefined
}

/** The host the repository at `root` has its origin on; none for no origin, or one in a folder on this disk. */
export async function originHost(root: string): Promise<string | undefined> {
  const url = await originUrl(root)
  return url ? remoteHostOf(url) : undefined
}

/**
 * The account a repository's own branches are sent as by a press of the person's (the Skills
 * page's Send, the clean-up of Claude Code web's branches): the one kept for it at its Share
 * switch, else the one runs use at its host. Nothing for a remote that is a folder on this disk,
 * which asks no login.
 */
export async function originAccountOf(root: string): Promise<{ ok: true; account?: RemoteAccount } | { ok: false; error: string }> {
  const host = await originHost(root)
  if (host === undefined) return { ok: true }
  const kept = await readRemoteAccount(root)
  if (kept) return { ok: true, account: kept }
  const runs = (await accountsByHost()).find(row => row.host === host)?.runs
  return remoteAccount(host, runs)
}

/**
 * git for the repository at `root`, its talks with origin going as {@link originAccountOf} says:
 * never as the person's own login. With no account to go as, those talks are refused in words.
 */
export async function originGit(root: string): Promise<GitRunner> {
  const as = await originAccountOf(root).catch(() => ({ ok: false as const, error: '' }))
  return accountGit(nodeGitRunner(), as.ok ? as.account : undefined)
}

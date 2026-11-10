import { nodeGitRunner, type GitRunner } from './git.js'
import { originUrl } from './origin.js'
import { spellingOfRemote } from './repository-address.js'

/**
 * The account OpenAgent sends a repository's branches as: one of OpenAgent's own accounts at the
 * git host, never the person's own login. The person names it where they turn sending on (the
 * personal folder's sync, a project's Share switch); it is kept in that repository's own git
 * config, on this computer only, as the account's login, its host, and the git settings its git
 * host package gave for it (`<git-host> git-config`): the way git asks for that account's login,
 * no secret itself. The person's own git never reads these keys, so their own pushes stay theirs.
 *
 * Every talk with `origin` that goes through {@link accountGit} drops the person's credential
 * helpers and uses those settings instead. A remote on a host with no account kept is refused,
 * so nothing goes out as the person; a remote that is a folder on this disk asks no login, and
 * goes as it is.
 */
export interface RemoteAccount {
  login: string
  /** The host the account is at: a remote elsewhere is refused. */
  host: string
  /** The git settings that make git use the account, as `[key, value]`, in order. */
  config: [string, string][]
}

const ACCOUNT_KEY = 'agent-data.account'
const HOST_KEY = 'agent-data.host'
const CONFIG_KEY = 'agent-data.config'

/** The git commands that talk with a remote: what goes as the kept account. */
const REMOTE_COMMANDS = new Set(['fetch', 'push', 'pull', 'ls-remote'])

/** The account kept for the repository at `cwd`; none when the person named none, or what is kept is not whole. */
export async function readRemoteAccount(cwd: string, git: GitRunner = nodeGitRunner()): Promise<RemoteAccount | undefined> {
  const get = (key: string, all = false): Promise<string> => git(['config', '--local', all ? '--get-all' : '--get', key], cwd).then(
    out => out.trim(),
    () => '',
  )
  const [login, host, lines] = await Promise.all([get(ACCOUNT_KEY), get(HOST_KEY), get(CONFIG_KEY, true)])
  if (!login || !host) return undefined
  const config: [string, string][] = []
  for (const line of lines ? lines.split('\n') : []) {
    const at = line.indexOf('=')
    if (at > 0) config.push([line.slice(0, at), line.slice(at + 1)])
  }
  return { login, host, config }
}

/** Keep `account` as the one the repository at `cwd` is sent as, in place of any kept before. */
export async function writeRemoteAccount(cwd: string, account: RemoteAccount, git: GitRunner = nodeGitRunner()): Promise<void> {
  await clearRemoteAccount(cwd, git)
  await git(['config', '--local', ACCOUNT_KEY, account.login], cwd)
  await git(['config', '--local', HOST_KEY, account.host], cwd)
  for (const [key, value] of account.config) await git(['config', '--local', '--add', CONFIG_KEY, `${key}=${value}`], cwd)
}

/** Forget the account the repository at `cwd` is sent as. */
export async function clearRemoteAccount(cwd: string, git: GitRunner = nodeGitRunner()): Promise<void> {
  for (const key of [ACCOUNT_KEY, HOST_KEY, CONFIG_KEY]) await git(['config', '--local', '--unset-all', key], cwd).catch(() => {})
}

/** The host a remote's address is on; none for a folder on this disk. */
export function remoteHostOf(remote: string): string | undefined {
  return spellingOfRemote(remote)?.split('/')[0]?.toLowerCase()
}

/** Why a talk with a remote did not go: no account of OpenAgent's to go as. */
export class NoRemoteAccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoRemoteAccountError'
  }
}

/** The sentence for a repository at `host` with no account kept. */
export function noAccountSentence(host: string): string {
  return `OpenAgent sends nothing to ${host} as your own login: pick one of OpenAgent's accounts there to send as`
}

/**
 * `git`, with every talk with `origin` going as an account of OpenAgent's: `account` when given,
 * else the one kept for the repository the command runs in. The person's credential helpers are
 * dropped first, theirs and any the environment set, so the account's are the only ones asked.
 * A remote on a host with no account to go as is refused with {@link NoRemoteAccountError}, and
 * one that is a folder on this disk goes as it is. Every other command is `git`'s own.
 */
export function accountGit(git: GitRunner = nodeGitRunner(), account?: RemoteAccount): GitRunner {
  return async (args, cwd) => {
    if (!REMOTE_COMMANDS.has(args[0] ?? '') || !args.includes('origin')) return git(args, cwd)
    const url = await originUrl(cwd, git)
    const host = url === undefined ? undefined : remoteHostOf(url)
    if (host === undefined) return git(args, cwd)
    const as = account ?? (await readRemoteAccount(cwd, git))
    if (!as) throw new NoRemoteAccountError(noAccountSentence(host))
    if (as.host.toLowerCase() !== host) throw new NoRemoteAccountError(`${noAccountSentence(host)}; @${as.login} is at ${as.host}`)
    return git(['-c', 'credential.helper=', ...as.config.flatMap(([key, value]) => ['-c', `${key}=${value}`]), ...args], cwd)
  }
}

import { homedir } from 'node:os'
import { errorMessage, noAccountSentence } from '@openagt/git-branches'
import { callerNow, type HostAccounts, type RepositoryAccount } from '@openagt/hooks'
import { HOST, gitConfig } from './accounts.js'
import { readAccounts, runCli, type GithubAccounts } from './cli.js'
import { nodeGhRunner } from './gh.js'
import { accountNamed } from './working-account.js'
import { ADD_ACCOUNT } from './ids.js'
import { accountsFor, loginsFor } from './team.js'

// OpenAgent's GitHub accounts as the dashboard and the other modules ask for them outside a run:
// the Permissions page's list, the accounts a git store's "Send as" offers, and the git settings
// a repository keeps to be sent as one of them. gh asks GitHub who each account is (most of a
// second), so a read is answered at once with the last answer while the accounts are read again
// behind it; a press that changes them throws the last answer away.

/** What one of the package's commands answered, run in this process: its JSON, or the line it refused with. */
export type CliAnswer = { ok: true; output: unknown } | { ok: false; error: string }

/** Run one of the package's commands in this process, in `cwd` (the person's home folder when unsaid), as a press of the dashboard's does. */
export async function cliAnswer(args: string[], cwd: string = homedir()): Promise<CliAnswer> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, { cwd, stdout: line => out.push(line), stderr: line => err.push(line) })
  if (code !== 0) return { ok: false, error: err.at(-1)?.trim() || `github ${args[0] ?? ''} failed` }
  try {
    return { ok: true, output: JSON.parse(out.join('\n')) as unknown }
  } catch {
    return { ok: false, error: `github ${args[0] ?? ''} printed no JSON` }
  }
}

/** What reads the accounts and an account's git settings; swapped in tests. */
export const accountsWiring: { read: () => Promise<GithubAccounts>; gitConfig: (login: string) => Promise<[string, string][]> } = {
  read: () => readAccounts(homedir()),
  gitConfig: async login => gitConfig((await accountNamed(login, homedir(), nodeGhRunner(), process.env)).dir),
}

let last: GithubAccounts | undefined
/** When the last answer was read. */
let lastAt = 0
let reading: Promise<GithubAccounts> | undefined

/**
 * How old the last answer may be before an ask reads the accounts again behind it: a read asks
 * GitHub once per account, and the asks come every few seconds (each push, each "Send as").
 */
export const ACCOUNTS_FRESH_MS = 60_000

/** OpenAgent's GitHub accounts: the last answer when there is one, the accounts read again behind it once it is a minute old. */
export async function githubAccounts(now: number = Date.now()): Promise<GithubAccounts> {
  if (last !== undefined && now - lastAt < ACCOUNTS_FRESH_MS) return last
  const read = reading ?? readAgain()
  if (last === undefined) return read
  // Its answer is for the next ask; a read that failed leaves the last answer standing.
  read.catch(() => undefined)
  return last
}

/** Read the accounts. Its answer is the last one only if it is still the read under way when it lands: no press came since. */
function readAgain(): Promise<GithubAccounts> {
  const read: Promise<GithubAccounts> = accountsWiring
    .read()
    .then(answer => {
      if (reading === read) {
        last = answer
        lastAt = Date.now()
      }
      return answer
    })
    .finally(() => {
      if (reading === read) reading = undefined
    })
  reading = read
  return read
}

/** A press changed the accounts: what is answered after it is read after it, not by a read already under way. */
export function accountsChanged(): void {
  last = undefined
  reading = undefined
  sendingAs.clear()
}

/** OpenAgent's GitHub accounts that GitHub still takes, and the one runs use: what a "Send as" offers; with none, the press that adds one. */
export async function hostAccounts(): Promise<HostAccounts[]> {
  // On a machine shared by a team, the person's accounts and the shared ones, their runs' one first among them (team.ts).
  const read = accountsFor(await githubAccounts(), callerNow())
  const accounts = read.accounts.filter(account => account.ok)
  const runs = accounts.find(account => account.runs)?.login
  return [{ host: HOST, logins: accounts.map(account => account.login), ...(runs !== undefined ? { runs } : {}), add: { module: 'github', action: ADD_ACCOUNT, label: 'Add a GitHub account' } }]
}

/** How long what was read of an account's git settings is kept: reading them checks the account with GitHub. */
const SEND_AS_KEEP_MS = 5 * 60_000

const sendingAs = new Map<string, { at: number; account: RepositoryAccount }>()

/**
 * What a repository on GitHub keeps to be sent as `login`, one of OpenAgent's accounts, kept a few
 * minutes: never the person's own login, so no login is refused. None for another host.
 */
export async function sendAs(host: string, login?: string): Promise<{ ok: true; account: RepositoryAccount } | { ok: false; error: string } | undefined> {
  if (host !== HOST) return undefined
  if (login === undefined) return { ok: false, error: `${noAccountSentence(host)}: add one in Permissions › Git hosts.` }
  if (typeof login !== 'string' || !/^\S+$/.test(login)) return { ok: false, error: `${String(login)} is no account.` }
  // On a machine shared by a team, nothing is sent as an account its person may not use.
  const caller = callerNow()
  if (caller && !loginsFor(caller, (await githubAccounts()).accounts.map(account => account.login)).includes(login)) return { ok: false, error: `@${login} is not your GitHub account here, and nobody shared it with the team.` }
  const known = sendingAs.get(login)
  if (known && Date.now() - known.at < SEND_AS_KEEP_MS) return { ok: true, account: known.account }
  try {
    const account = { login, host: HOST, config: await accountsWiring.gitConfig(login) }
    sendingAs.set(login, { at: Date.now(), account })
    return { ok: true, account }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

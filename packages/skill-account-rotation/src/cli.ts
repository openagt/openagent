import { hostname } from 'node:os'
import { OWN_NAME, readAccounts, shownAccounts, useFirst, type AccountsAgent, type ShownAccount } from './accounts.js'
import { loginWiring, nameTaken, ownName, removeAdded, signIn, type LoginWiring } from './login.js'
import { readUsage } from './usage.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went: 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the skills' commands, so a person and an agent read it the same way.
 */

export const USAGE = `usage: account-rotation <command>

  list                          the accounts of each agent in the order runs try them, never a login
  usage                         how full each account is, read now where it can be
  add <claude|codex> <name>     a new account under <name>: the browser opens, and it waits for the person to sign in
  remove <claude|codex> <name>  take an added account off the list
  use-first <claude|codex> <name>
                                the account runs try first from now on`

export interface CliIo {
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** The user's environment. Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /** What adding and removing reach for, for tests. Default the logins of {@link env}. */
  wiring?: LoginWiring
}

const isAgent = (value: string | undefined): value is AccountsAgent => value === 'claude' || value === 'codex'

/** Why a list only a server's page can change is refused here: a server's own logins go through its page. */
const ON_SERVER = 'On a server, accounts are added and removed in Settings › Accounts.'

/**
 * An agent's accounts as `list` says them. The person's own says the computer it is a login on, and
 * while it goes by no name they gave it, who it is, as `who`, or `signedOut` when the agent has no
 * login of theirs: an agent this computer may not even have. Commands still take its `name`.
 */
async function listed(agent: AccountsAgent, wiring: LoginWiring): Promise<(ShownAccount & { who?: string; signedOut?: true; computer?: string })[]> {
  const accounts = shownAccounts(readAccounts(wiring.path(agent)))
  const unnamed = (a: ShownAccount): boolean => a.own && a.name === OWN_NAME
  const who = accounts.some(unnamed) ? await ownName(agent, wiring) : undefined
  const computer = hostname().replace(/\.local$/i, '')
  return accounts.map(a => {
    if (!a.own) return a
    if (!unnamed(a)) return { ...a, computer }
    return who !== undefined ? { ...a, who, computer } : { ...a, signedOut: true, computer }
  })
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const env = io.env ?? process.env
  const wiring = io.wiring ?? loginWiring(env)
  const [command, agent, name] = argv
  const refuse = (why: string): number => {
    io.stderr(why)
    return 1
  }
  const answer = (value: unknown): number => {
    io.stdout(JSON.stringify(value))
    return 0
  }
  if (command === 'list' && argv.length === 1) {
    return answer({ claude: await listed('claude', wiring), codex: await listed('codex', wiring) })
  }
  if (command === 'usage' && argv.length === 1) return answer(await readUsage(wiring))
  if ((command !== 'add' && command !== 'remove' && command !== 'use-first') || !isAgent(agent) || name === undefined || argv.length !== 3) {
    io.stderr(USAGE)
    return 2
  }
  if (command === 'use-first') {
    if (!readAccounts(wiring.path(agent)).some(a => a.name === name)) return refuse(`There is no ${agent} account named ${name}.`)
    return answer(shownAccounts(useFirst(name, wiring.path(agent))))
  }
  if (env['OPENAGENT_SERVER'] === '1') return refuse(ON_SERVER)
  if (command === 'remove') {
    const gone = await removeAdded(agent, name, wiring)
    if (!gone) return refuse(`There is no added ${agent} account named ${name}.`)
    return answer(shownAccounts(readAccounts(wiring.path(agent))))
  }
  const said = name.trim()
  const taken = await nameTaken(agent, said, wiring)
  if (taken) return refuse(taken)
  io.stderr('Sign in to the account being added in the browser that opens.')
  const failed = await signIn(agent, said, wiring, agent === 'codex' ? { onUrl: url => io.stderr(`If the browser is signed in to another account, open this in a private window: ${url}`) } : {})
  if (failed !== undefined) return refuse(failed)
  return answer(shownAccounts(readAccounts(wiring.path(agent))))
}

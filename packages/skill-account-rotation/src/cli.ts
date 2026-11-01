import { hostname } from 'node:os'
import { handedOverBy, OWN_NAME, readAccounts, shownAccounts, useFirst, type AccountsAgent, type ShownAccount } from './accounts.js'
import { addingNow, beginAdding, bringCode, cancelAdding, runAdding } from './adding.js'
import { comesBackFrom, logOut, loginWiring, ownLoginThere, ownName, removeAdded, type LoginWiring } from './login.js'
import { readUsage } from './usage.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went: 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the skills' commands, so a person and an agent read it the same way.
 */

export const USAGE = `usage: account-rotation <command>

  list                          the accounts of each agent in the order runs try them, never a login
  usage                         how full each account is, read now where it can be
  add <claude|codex> <name>     start adding a new account under <name>: the person signs in, and this answers at once
  adding                        how adding stands for each agent: where to sign in, and why the last one did not go through
  add-code <claude|codex>       hand the sign-in the code its page showed, on standard input
  add-cancel <claude|codex>     stop adding
  remove <claude|codex> <name>  take an added account off the list
  logout <claude|codex>         log the person's own login out, their terminal too
  use-first <claude|codex> <name>
                                the account runs try first from now on`

export interface CliIo {
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** The user's environment. Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /** What adding and removing reach for, for tests. Default the logins of {@link env}. */
  wiring?: LoginWiring
  /** What was handed to the command on standard input; the process's own when unsaid. */
  stdin?: () => Promise<string>
}

/** All of the process's standard input, as text. */
async function readStdin(): Promise<string> {
  let said = ''
  for await (const chunk of process.stdin.setEncoding('utf8')) said += chunk as string
  return said
}

const isAgent = (value: string | undefined): value is AccountsAgent => value === 'claude' || value === 'codex'

/**
 * An agent's accounts as `list` says them. The person's own says the computer it is a login on, who
 * it is while it goes by no name they gave it, as `who`, and `signedOut` when the agent has no login
 * of theirs: runs skip it then. Commands still take its `name`. On a server, one a computer of the
 * person's handed over says which, as `from`, and `comesBack` when removing it here would only bring it back.
 */
async function listed(agent: AccountsAgent, wiring: LoginWiring): Promise<(ShownAccount & { who?: string; signedOut?: true; computer?: string; from?: string; comesBack?: true })[]> {
  const accounts = shownAccounts(readAccounts(wiring.path(agent)))
  const there = ownLoginThere(agent, wiring)
  const unnamed = (a: ShownAccount): boolean => a.name === OWN_NAME
  const who = accounts.some(a => a.own && unnamed(a)) ? await ownName(agent, wiring) : undefined
  const computer = hostname().replace(/\.local$/i, '')
  const handedOver = handedOverBy(agent, wiring.env)
  return accounts.map(a => {
    if (a.own) return { ...a, computer, ...(unnamed(a) && who !== undefined ? { who } : {}), ...(there ? {} : { signedOut: true as const }) }
    const handed = handedOver.get(a.name)
    return handed ? { ...a, from: handed.from, ...(handed.comesBack ? { comesBack: true as const } : {}) } : a
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
  if (command === 'adding' && argv.length === 1) return answer({ claude: addingNow('claude', wiring), codex: addingNow('codex', wiring) })
  if (!isAgent(agent)) {
    io.stderr(USAGE)
    return 2
  }
  if (command === 'add-code' && argv.length === 2) {
    const brought = bringCode(agent, await (io.stdin ?? readStdin)(), wiring)
    return brought.ok ? answer(addingNow(agent, wiring)) : refuse(brought.error)
  }
  if (command === 'add-cancel' && argv.length === 2) {
    cancelAdding(agent, wiring)
    return answer(addingNow(agent, wiring))
  }
  if (command === 'logout' && argv.length === 2) {
    const failed = await logOut(agent, wiring)
    return failed === undefined ? answer(await listed(agent, wiring)) : refuse(failed)
  }
  if (name === undefined || argv.length !== 3) {
    io.stderr(USAGE)
    return 2
  }
  if (command === 'add') {
    const begun = await beginAdding(agent, name, wiring)
    return begun.ok ? answer(addingNow(agent, wiring)) : refuse(begun.error)
  }
  // The sign-in's own process, which `add` starts: it ends when the person has signed in, or stopped.
  if (command === 'add-worker') {
    const stop = new AbortController()
    process.once('SIGTERM', () => stop.abort())
    await runAdding(agent, name, wiring, stop.signal)
    return 0
  }
  if (command === 'use-first') {
    if (!readAccounts(wiring.path(agent)).some(a => a.name === name)) return refuse(`There is no ${agent} account named ${name}.`)
    return answer(shownAccounts(useFirst(name, wiring.path(agent))))
  }
  if (command === 'remove') {
    const from = comesBackFrom(agent, name, wiring)
    if (from !== undefined) return refuse(`${name}'s account comes from ${from}: remove it there.`)
    const gone = await removeAdded(agent, name, wiring)
    if (!gone) return refuse(`There is no added ${agent} account named ${name}.`)
    return answer(shownAccounts(readAccounts(wiring.path(agent))))
  }
  io.stderr(USAGE)
  return 2
}

import { readAccounts, shareAccount, shownAccounts, useFirst } from './accounts.js'
import { callerFromEnv, ownsIt } from '@openagt/hooks'
import { addingNow, beginAdding, bringCode, cancelAdding, runAdding } from './adding.js'
import { logOut, removeAdded } from './login.js'
import { addingAll, listed, listing } from './reads.js'
import { loginWiring, type LoginWiring } from './wiring.js'
import { readUsage } from './usage.js'
import { unknownWord, usageError, wrongArguments, helpRows } from '@openagt/hooks/command'
import { UnknownAgent } from '../agents.js'

/**
 * The command line: a result is one JSON document on stdout; a refusal is one line for a person on
 * stderr, with nothing on stdout. The exit code says how it went: 0 for a result, 1 for a refusal
 * or a failure, 2 for a command that could not be read.
 */

export const USAGE = `usage: account-rotation <command>

${helpRows([
  ['list', `the accounts of each coding agent's list in the order runs try them, never a login, and the lists whose agent is not installed`],
  ['usage', 'how full each account is, read now where it can be'],
  ['add <claude|codex> <name>', 'start adding a new account under <name>: the person signs in, and this answers at once'],
  ['adding', 'how adding stands for each list: where to sign in, and why the last one did not go through'],
  ['add-code <claude|codex>', 'hand the sign-in the code its page showed, on standard input'],
  ['add-cancel <claude|codex>', 'stop adding'],
  ['remove <claude|codex> <name>', 'take an added account off the list'],
  ['logout <claude|codex>', `log the person's own login out, their terminal too`],
  ['use-first <claude|codex> <name>', 'the account runs try first from now on'],
  ['share <claude|codex> <name> <on|off>', "on a machine shared by a team, let everyone's runs use your account, or stop"],
])}`

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

/** Every command, `add`'s own sign-in process included. */
const COMMANDS = new Set(['list', 'usage', 'add', 'adding', 'add-code', 'add-cancel', 'remove', 'logout', 'use-first', 'share', 'add-worker'])

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
  const misread = (): number => {
    io.stderr(command === undefined ? USAGE : usageError('account-rotation', COMMANDS.has(command) ? wrongArguments(command, argv.slice(1)) : unknownWord(command)))
    return 2
  }
  if ((command === '--help' || command === '-h') && argv.length === 1) {
    io.stdout(USAGE)
    return 0
  }
  // The lists are the coding agents' of the OpenAgent that started this command: with none handed down, there is none.
  if (COMMANDS.has(command ?? '') && (await wiring.logins()).length === 0) return refuse(new UnknownAgent(undefined, []).message)
  if (command === 'list' && argv.length === 1) return answer(await listing(wiring))
  if (command === 'usage' && argv.length === 1) return answer(await readUsage(wiring))
  if (command === 'adding' && argv.length === 1) return answer(await addingAll(wiring))
  // The list a command names, among the coding agents' lists: one of no agent here is a command that cannot be read.
  const logins = agent === undefined || !COMMANDS.has(command ?? '') ? undefined : (await wiring.logins()).find(one => one.list === agent)
  if (!logins) return misread()
  const list = logins.list
  // On a machine shared by a team, the command runs for one person: it changes only what is theirs.
  const caller = callerFromEnv(env)
  const theirs = (named: string | undefined): boolean => {
    const account = readAccounts(wiring.path(list)).find(a => (named === undefined ? a.login === undefined : a.name === named))
    return account === undefined || ownsIt(caller, account)
  }
  const notTheirs = (named: string | undefined): number => refuse(`That ${list} account is ${named === undefined ? 'the team owner’s' : 'someone else’s'}: only they change it.`)
  if (command === 'share' && argv.length === 4 && name !== undefined && (argv[3] === 'on' || argv[3] === 'off')) {
    if (!caller) return refuse('Sharing is for a machine shared by a team.')
    try {
      return answer(shownAccounts(shareAccount(name, argv[3] === 'on', caller, wiring.path(list)), caller))
    } catch (err) {
      return refuse(err instanceof Error ? err.message : String(err))
    }
  }
  if (command === 'add-code' && argv.length === 2) {
    const brought = bringCode(logins, await (io.stdin ?? readStdin)(), wiring)
    return brought.ok ? answer(addingNow(list, wiring)) : refuse(brought.error)
  }
  if (command === 'add-cancel' && argv.length === 2) {
    cancelAdding(list, wiring)
    return answer(addingNow(list, wiring))
  }
  if (command === 'logout' && argv.length === 2) {
    if (!theirs(undefined)) return notTheirs(undefined)
    const failed = await logOut(logins, wiring)
    return failed === undefined ? answer(await listed(logins, wiring)) : refuse(failed)
  }
  if (name === undefined || argv.length !== 3) return misread()
  if (command === 'add') {
    const begun = await beginAdding(logins, name, wiring)
    return begun.ok ? answer(addingNow(list, wiring)) : refuse(begun.error)
  }
  // The sign-in's own process, which `add` starts: it ends when the person has signed in, or stopped.
  if (command === 'add-worker') {
    const stop = new AbortController()
    process.once('SIGTERM', () => stop.abort())
    await runAdding(logins, name, wiring, stop.signal)
    return 0
  }
  if (command === 'use-first') {
    if (!readAccounts(wiring.path(list)).some(a => a.name === name)) return refuse(`There is no ${list} account named ${name}.`)
    return answer(shownAccounts(useFirst(name, wiring.path(list)), caller))
  }
  if (command === 'remove') {
    if (!theirs(name)) return notTheirs(name)
    const gone = await removeAdded(logins, name, wiring)
    if (!gone) return refuse(`There is no added ${list} account named ${name}.`)
    return answer(shownAccounts(readAccounts(wiring.path(list)), caller))
  }
  return misread()
}

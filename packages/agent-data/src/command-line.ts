import { parseArgs } from 'node:util'
import type { CommitMessage } from './file-branch.js'
import { checkoutRoot, errorMessage, gitReason, type GitRunner } from './git.js'
import { listProjectDir, openProjectReader, readProjectFile, writeProjectDataDetached, type ProjectReader } from './project-data.js'

/**
 * The contract every OpenAgent command keeps (`tickets`, `queue`, `logs`, `branches`, `github`,
 * `scheduler`, `orchestration`, `agent-runner`), so an agent, a person and OpenAgent read any of
 * them the same way: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went — 0 for a result, 1 for a refusal or a failure, 2 for a command line that could not be
 * read. A refusal is a rule saying no (there is no such ticket, the branch is someone else's); it
 * is reported on stdout as `{ ok: false, reason }` so a caller parsing the output learns why, and
 * on stderr so a person does. A failure is reported the same way, its `reason` naming what failed
 * and its `detail` saying how.
 */

/** Where a command's answer goes: the JSON for a caller on stdout, the line for a person on stderr. */
export interface CommandOutput {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

/** A refusal: a rule said no, and the caller learns which. */
export type Refusal = { ok: false; reason: string; [key: string]: unknown }

/** Thrown inside a command to end it with a refusal: `outcome` on stdout, `line` on stderr, exit 1. */
export class Refused extends Error {
  constructor(
    readonly outcome: Refusal,
    readonly line: string,
  ) {
    super(line)
  }
}

/** Thrown inside a command for a command line that cannot be read: why, then the usage, on stderr, exit 2. */
export class UsageError extends Error {}

/** One command: the arguments after its name, then what the command line hands every command. */
export type Command<Context extends unknown[]> = (args: string[], ...context: Context) => Promise<unknown>

/** How an error no command meant reads: its `reason`, and its `detail` taken from the error. */
export interface Failure {
  reason: string
  detail: (err: unknown) => string
}

/** A git command failed: git's own line about it as the detail. */
export const GIT_FAILED: Failure = { reason: 'git-failed', detail: gitReason }

/** Anything else failed: the error's message as the detail. */
export const FAILED: Failure = { reason: 'failed', detail: errorMessage }

export interface CommandLine<Context extends unknown[]> {
  usage: string
  commands: Record<string, Command<Context>>
  /** The command run when the line names none: it is empty, or starts with a flag. Without one, such a line is a usage error. */
  bare?: Command<Context>
  /** How an error no command meant reads; `FAILED` unless said. */
  failure?: Failure
}

/**
 * Run one command line, `argv` being everything after the program's name, and answer it as the
 * contract says. Resolves to the exit code; every error a command throws is answered, none escapes.
 */
export async function runCommandLine<Context extends unknown[]>(argv: string[], output: CommandOutput, line: CommandLine<Context>, ...context: Context): Promise<number> {
  const [name, ...rest] = argv
  const bare = name === undefined || name.startsWith('--')
  const command = bare ? line.bare : Object.hasOwn(line.commands, name) ? line.commands[name] : undefined
  if (!command) {
    output.stderr(line.usage)
    return 2
  }
  try {
    output.stdout(JSON.stringify(await command(bare ? argv : rest, ...context)))
    return 0
  } catch (err) {
    if (err instanceof UsageError) {
      output.stderr(`${err.message}\n\n${line.usage}`)
      return 2
    }
    if (err instanceof Refused) {
      output.stdout(JSON.stringify(err.outcome))
      output.stderr(err.line)
      return 1
    }
    const failure = line.failure ?? FAILED
    const detail = failure.detail(err)
    output.stdout(JSON.stringify({ ok: false, reason: failure.reason, detail }))
    output.stderr(detail)
    return 1
  }
}

type Options = Record<string, { type: 'string' | 'boolean' }>

type ParsedArgs<O extends Options> = ReturnType<typeof parseArgs<{ args: string[]; options: O; allowPositionals: true; strict: true }>>

/**
 * `parseArgs` with the count of positional arguments checked: anything it cannot read, or too few
 * or too many, is a usage error. `max` is `Infinity` for a command that takes any number.
 */
export function parseCommandArgs<O extends Options>(args: string[], options: O, min: number, max: number = min): ParsedArgs<O> {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true })
    if (parsed.positionals.length < min || parsed.positionals.length > max) throw new UsageError(`expected ${countWords(min, max)} argument(s), got ${parsed.positionals.length}`)
    return parsed
  } catch (err) {
    throw err instanceof UsageError ? err : new UsageError(errorMessage(err))
  }
}

/** How many arguments a command takes, in words: `1`, `at least 1`, `at most 2`, `1 to 3`. */
function countWords(min: number, max: number): string {
  if (min === max) return `${min}`
  if (max === Infinity) return `at least ${min}`
  if (min === 0) return `at most ${max}`
  return `${min} to ${max}`
}

/**
 * Outside a repository a command has nothing to act on: `read`'s failure is said as a refusal
 * then, not as a git failure. Only git's own "not a git repository" reads as that; a timeout, a
 * missing git, or a corrupt repository stays the failure it is.
 */
export async function inRepo<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (err) {
    if (!/not a git repository/i.test(errorMessage(err))) throw err
    throw new Refused({ ok: false, reason: 'not-a-repo' }, 'not inside a git repository')
  }
}

/**
 * The project's data opened for a command's reads, from wherever in the repository the command
 * runs; outside one, the not-a-repo refusal. Origin's copy, fetched first, so a command sees what
 * every writer pushed; or with `local` this machine's copy with no fetch, for the dashboard's polling.
 */
export async function commandReader(cwd: string, local: boolean | undefined, git: GitRunner): Promise<ProjectReader> {
  await inRepo(() => checkoutRoot(cwd, git))
  if (!local) return openProjectReader(cwd, { git })
  return { read: rel => readProjectFile(cwd, rel, {}, { git }), list: dir => listProjectDir(cwd, dir, {}, { git }) }
}

/**
 * One write by a command, as a one-shot writer: to origin when the project is shared, else a local
 * commit; outside a repository, the not-a-repo refusal. Answers what `op` found the last time it
 * ran: a write that loses a race runs it again on the new tip, and only that run's finding landed.
 */
export async function commandWrite<T>(cwd: string, message: CommitMessage, op: (dir: string) => Promise<T>, git: GitRunner): Promise<T> {
  await inRepo(() => checkoutRoot(cwd, git))
  let found: T | undefined
  await writeProjectDataDetached(cwd, message, async dir => {
    found = await op(dir)
  }, { git })
  return found as T
}

import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { checkoutRoot, gitReason, nodeBranchFileFs, nodeGitRunner, openProjectReader, writeProjectDataDetached, type ProjectReader, type GitRunner } from '@openagt/agent-data'
import { QUEUE_FILE } from './names.js'
import { appendQueueEntry, insertQueueEntry, parseQueueEntries, parseQueueSections, readQueue, removeQueueEntry } from './queue.js'

/**
 * The command line over the package: the same operations a daemon calls, for an agent (and a
 * person) in a shell, in any clone of the repository.
 *
 * The contract: JSON on stdout, one line for a person on stderr, and the exit code says how it
 * went — 0 for a result, 1 for a refusal or a git failure, 2 for a command that could not be
 * read. A refusal is a rule saying no (there is no such entry); it is reported on stdout as
 * `{ ok: false, reason }` so a caller parsing the output learns why, and on stderr so a person does.
 *
 * A project kept on this machine reads and writes its directory in the personal folder, one
 * commit per write. A shared project reads origin's copy of its branch, fetched first, so a
 * command sees what every writer pushed — its own earlier writes included — and writes as a
 * remote writer: one commit each, on a throwaway checkout of origin's tip, pushed straight to the
 * branch; a rejected push is re-applied on the new tip and pushed again. The persistent checkout
 * a daemon keeps is never touched.
 *
 * A dashboard that shows the queue reads it through the same command, so it needs no code of this
 * package: `--local` reads this machine's copy (the directory a writer writes to) with no fetch,
 * fast enough to poll, and `--full`
 * prints each entry with the priority section it sits in, so the dashboard can show the sections.
 * The package declares the command as OpenAgent's queue provider (`"openagent": { "queue":
 * "queue" }`), which reads `queue --local`; the package's own module reads `queue --local --full`.
 */

export const USAGE = `usage: queue [command]

  (no command)                       the queue's open entries, in order of work
  add <text> [--priority N]          put an entry on the queue, in its priority section
  done <text>                        take an entry off the queue

  For a dashboard that shows the queue, not for an agent:
  --local                            with the bare command: read this machine's copy, no fetch from
                                     origin
  --full                             with the bare command: each entry as {"entry", "priority"}, the
                                     priority of the section it sits in (absent outside any)

JSON on stdout. Exit code 1 for a refusal or a git failure (the reason on stderr), 2 for a usage error.`

/** The streams and the working directory a run of the CLI sees. */
export interface CliIo {
  cwd: string
  stdout: (line: string) => void
  stderr: (line: string) => void
}

/** A refusal: a rule said no, and the caller learns which. */
export type CliRefusal = { ok: false; reason: string; [key: string]: unknown }

/** Thrown inside a command to end it with a refusal. */
class Refused extends Error {
  constructor(
    readonly outcome: CliRefusal,
    readonly line: string,
  ) {
    super(line)
  }
}

/** Thrown inside a command for an argument that cannot be read: usage on stderr, exit 2. */
class Usage extends Error {}

/** Run the CLI: `argv` is everything after the program name. Resolves to the exit code. */
export async function runCli(argv: string[], io: CliIo, git: GitRunner = nodeGitRunner()): Promise<number> {
  const [command, ...rest] = argv
  const bare = command === undefined || command.startsWith('--')
  const run = bare ? list : Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined
  if (!run) {
    io.stderr(USAGE)
    return 2
  }
  try {
    io.stdout(JSON.stringify(await run(bare ? argv : rest, io, git)))
    return 0
  } catch (err) {
    if (err instanceof Usage) {
      io.stderr(`${err.message}\n\n${USAGE}`)
      return 2
    }
    if (err instanceof Refused) {
      io.stdout(JSON.stringify(err.outcome))
      io.stderr(err.line)
      return 1
    }
    const detail = gitReason(err)
    io.stdout(JSON.stringify({ ok: false, reason: 'git-failed', detail }))
    io.stderr(detail)
    return 1
  }
}

type Command = (args: string[], io: CliIo, git: GitRunner) => Promise<unknown>

/**
 * The bare command: the open entries, in order of work. `--local` reads this machine's copy, no
 * fetch; `--full` prints each entry with the priority of the section it sits in.
 */
const list: Command = async (args, io, git) => {
  const { values } = parse(args, { local: { type: 'boolean' }, full: { type: 'boolean' } }, 0)
  let md: string
  if (values.local) {
    const root = await inRepo(() => checkoutRoot(io.cwd, git))
    md = (await readQueue(root)) ?? ''
  } else {
    const reader = await open(io.cwd, git)
    md = (await reader.read(QUEUE_FILE)) ?? ''
  }
  return values.full ? parseQueueSections(md) : parseQueueEntries(md)
}

const COMMANDS: Record<string, Command> = {
  async add(args, io, git) {
    const { positionals, values } = parse(args, { priority: { type: 'string' } }, 1)
    const entry = positionals[0]!.trim()
    if (!entry) throw new Usage('the entry is empty')
    const priority = values.priority === undefined ? undefined : priorityArg(values.priority)
    await write(io.cwd, `queue add: ${entry}`, async dir => {
      const md = await readOr(dir, '')
      await writeQueue(dir, priority === undefined ? appendQueueEntry(md, entry) : insertQueueEntry(md, entry, priority))
    }, git)
    return { ok: true, entry, ...(priority === undefined ? {} : { priority }) }
  },

  async done(args, io, git) {
    const { positionals } = parse(args, {}, 1)
    const entry = positionals[0]!.trim()
    let found = false
    await write(io.cwd, `queue done: ${entry}`, async dir => {
      const md = await readOr(dir, '')
      found = parseQueueEntries(md).includes(entry)
      if (found) await writeQueue(dir, removeQueueEntry(md, entry))
    }, git)
    if (!found) throw new Refused({ ok: false, reason: 'no-entry', entry }, `no open queue entry reads "${entry}"`)
    return { ok: true, entry }
  },
}

/** The queue file inside a checkout, read as `fallback` when absent. */
async function readOr(dir: string, fallback: string): Promise<string> {
  return nodeBranchFileFs().read(join(dir, QUEUE_FILE)).catch(() => fallback)
}

async function writeQueue(dir: string, md: string): Promise<void> {
  await nodeBranchFileFs().write(join(dir, QUEUE_FILE), md)
}

/** The project's data opened for reading, from wherever the command runs; outside a repo, a refusal. */
async function open(cwd: string, git: GitRunner): Promise<ProjectReader> {
  await inRepo(() => checkoutRoot(cwd, git))
  return openProjectReader(cwd, { git })
}

/** One write as a one-shot writer: to origin when the project is shared, else as a local commit. */
async function write(cwd: string, message: string, op: (dir: string) => Promise<void>, git: GitRunner): Promise<void> {
  await inRepo(() => checkoutRoot(cwd, git))
  await writeProjectDataDetached(cwd, message, op, { git })
}

function priorityArg(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) > 10) throw new Usage(`--priority takes 0 to 10, got ${value}`)
  return Number(value)
}

/**
 * Outside a repo, the commands have nothing to act on: said as a refusal, not a git failure.
 * Only git's own "not a git repository" reads as that; a timeout, a missing git, or a corrupt
 * repo stays the failure it is.
 */
async function inRepo<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (err) {
    if (!/not a git repository/i.test(err instanceof Error ? err.message : String(err))) throw err
    throw new Refused({ ok: false, reason: 'not-a-repo' }, 'not inside a git repository')
  }
}

type Options = Record<string, { type: 'string' | 'boolean' }>

/** `parseArgs` with the positional count checked: too few or too many is a usage error. */
function parse<O extends Options>(args: string[], options: O, min: number, max: number = min) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true })
    if (parsed.positionals.length < min || parsed.positionals.length > max) throw new Usage(`expected ${max === min ? min : `${min} to ${max}`} argument(s), got ${parsed.positionals.length}`)
    return parsed
  } catch (err) {
    throw err instanceof Usage ? err : new Usage(err instanceof Error ? err.message : String(err))
  }
}

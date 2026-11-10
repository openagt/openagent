import { join } from 'node:path'
import { GIT_FAILED, Refused, UsageError, checkoutRoot, inRepo, nodeBranchFileFs, nodeGitRunner, openProjectReader, parseCommandArgs, runCommandLine, writeProjectDataDetached, type Command, type ProjectReader, type GitRunner } from '@openagt/agent-data'
import { QUEUE_FILE } from './names.js'
import { appendQueueEntry, insertQueueEntry, parseQueueEntries, parseQueueSections, readQueue, removeQueueEntry } from './queue.js'

/**
 * The command line over the package: the same operations a daemon calls, for an agent (and a
 * person) in a shell, in any clone of the repository. It answers as every OpenAgent command does
 * (`runCommandLine`); a refusal here is a rule saying no: there is no such entry.
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

/** Run the CLI: `argv` is everything after the program name. Resolves to the exit code. */
export function runCli(argv: string[], io: CliIo, git: GitRunner = nodeGitRunner()): Promise<number> {
  return runCommandLine(argv, io, { usage: USAGE, commands: COMMANDS, bare: list, failure: GIT_FAILED }, io, git)
}

/**
 * The bare command: the open entries, in order of work. `--local` reads this machine's copy, no
 * fetch; `--full` prints each entry with the priority of the section it sits in.
 */
const list: Command<[CliIo, GitRunner]> = async (args, io, git) => {
  const { values } = parseCommandArgs(args, { local: { type: 'boolean' }, full: { type: 'boolean' } }, 0)
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

const COMMANDS: Record<string, Command<[CliIo, GitRunner]>> = {
  async add(args, io, git) {
    const { positionals, values } = parseCommandArgs(args, { priority: { type: 'string' } }, 1)
    const entry = positionals[0]!.trim()
    if (!entry) throw new UsageError('the entry is empty')
    const priority = values.priority === undefined ? undefined : priorityArg(values.priority)
    await write(io.cwd, `queue add: ${entry}`, async dir => {
      const md = await queueIn(dir)
      await writeQueue(dir, priority === undefined ? appendQueueEntry(md, entry) : insertQueueEntry(md, entry, priority))
    }, git)
    return { ok: true, entry, ...(priority === undefined ? {} : { priority }) }
  },

  async done(args, io, git) {
    const { positionals } = parseCommandArgs(args, {}, 1)
    const entry = positionals[0]!.trim()
    const found = await write(io.cwd, `queue done: ${entry}`, async dir => {
      const md = await queueIn(dir)
      if (!parseQueueEntries(md).includes(entry)) return false
      await writeQueue(dir, removeQueueEntry(md, entry))
      return true
    }, git)
    if (!found) throw new Refused({ ok: false, reason: 'no-entry', entry }, `no open queue entry reads "${entry}"`)
    return { ok: true, entry }
  },
}

/** The queue file inside a checkout; an absent one reads as an empty queue. */
async function queueIn(dir: string): Promise<string> {
  return nodeBranchFileFs().read(join(dir, QUEUE_FILE)).catch(() => '')
}

async function writeQueue(dir: string, md: string): Promise<void> {
  await nodeBranchFileFs().write(join(dir, QUEUE_FILE), md)
}

/** The project's data opened for reading, from wherever the command runs; outside a repo, a refusal. */
async function open(cwd: string, git: GitRunner): Promise<ProjectReader> {
  await inRepo(() => checkoutRoot(cwd, git))
  return openProjectReader(cwd, { git })
}

/**
 * One write as a one-shot writer: to origin when the project is shared, else as a local commit.
 * Answers what `op` found the last time it ran: a write that loses a race runs it again on the
 * new tip, and only that run's finding is what landed.
 */
async function write<T>(cwd: string, message: string, op: (dir: string) => Promise<T>, git: GitRunner): Promise<T> {
  await inRepo(() => checkoutRoot(cwd, git))
  let found: T | undefined
  await writeProjectDataDetached(cwd, message, async dir => {
    found = await op(dir)
  }, { git })
  return found as T
}

function priorityArg(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) > 10) throw new UsageError(`--priority takes 0 to 10, got ${value}`)
  return Number(value)
}

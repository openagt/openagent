import { parseArgs } from 'node:util'
import { checkoutRoot, gitReason, nodeGitRunner, openBranchReader, type BranchReader, type GitRunner, DATA_BRANCH } from '@openagt/agent-data'
import { RUNS_DIR } from './names.js'
import { agentLines, isRunId, newestFirst, parseDiary, parseRunCard, publicCard, runCardFile, runDiaryFile, runIdOfFile, type RunCard, type RunPatch } from './run.js'
import { deleteRun, findRun, listRuns, patchRun, readDiary, resolveLogsDeps, runFiles, runsPath } from './store.js'
import { peopleOf, readCommitLines } from './people.js'
import { skillUseOf } from './skill-use.js'

/**
 * The command line over the package: the reads a daemon's pages do, for an agent (and a person)
 * in a shell, in any clone of the repository. An agent only reads: its run is recorded by the
 * process that ran it, not by the agent.
 *
 * A dashboard that shows the runs reads and changes them through the same command, so it needs
 * no code of this package: `--local` reads the persistent checkout the writer keeps at
 * `.branches/agent-data` instead of origin (no fetch, fast enough to poll), `--full` prints the
 * whole record (the writer's `caller` key, every diary line), and `delete` / `patch` are its
 * Delete and Open-PR buttons, written through that checkout like the writer's own records.
 *
 * The contract: JSON on stdout, one line for a person on stderr, and the exit code says how it
 * went — 0 for a result, 1 for a refusal or a git failure, 2 for a command that could not be
 * read. A refusal is a rule saying no (there is no such run); it is reported on stdout as
 * `{ ok: false, reason }` so a caller parsing the output learns why, and on stderr so a person does.
 *
 * Reads go to origin's copy of the branch, fetched once, so a command sees every run every
 * machine pushed. The persistent checkout is read only with `--local` and written only by
 * `delete` and `patch`.
 */

/** How many runs the bare command prints unless told otherwise: enough to see what happened lately, not the whole history. */
export const DEFAULT_LIMIT = 20

export const USAGE = `usage: logs [command]

  (no command) [--branch <name>] [--limit N]
                                     the runs, newest first (the newest ${DEFAULT_LIMIT} unless --limit says
                                     otherwise); --branch keeps the runs on one branch
  show <id>                          one run: its card, and what the agent said, its result,
                                     how it ended, what it cost

  For a dashboard that shows the runs, not for an agent:
  --local                            with either read: read the checkout kept at .branches/agent-data,
                                     no fetch from origin
  --full                             with either read: the whole card (with the writer's caller key)
                                     and, for show, every diary line
  people [--days N]                  who works here: each person who started runs (by the folder their
                                     runs are kept in) or committed to the main branch, with their runs
                                     of the last N days (30 unless said), what they cost, how many are
                                     going now, their commits, the name git knows them by, and when
                                     they last did either
  skills [--days N]                  which skills the agents used in the last N days (30 unless said): for each, how many
                                     times it was loaded or a run started with its command, in how many runs, and when last
  delete <id>                        remove a run, card and diary, as one commit
  patch <id> [--branch <name>] [--pr <number> --pr-url <url>] [--landed <commit> --from <commit>]
                                     set the branch the work landed on, and its pull request

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
  const run = command === undefined || command.startsWith('--') ? list : Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined
  const args = command === undefined || command.startsWith('--') ? argv : rest
  if (!run) {
    io.stderr(USAGE)
    return 2
  }
  try {
    io.stdout(JSON.stringify(await run(args, io, git)))
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

/** The bare command: the runs, newest first, filtered and capped. */
const list: Command = async (args, io, git) => {
  const { values } = parse(args, { branch: { type: 'string' }, limit: { type: 'string' }, ...READ_FLAGS }, 0)
  const limit = values.limit === undefined ? DEFAULT_LIMIT : limitArg(values.limit)
  const keep = (card: RunCard): boolean => values.branch === undefined || card.branch === values.branch
  const shown = values.full ? (card: RunCard) => card : publicCard
  if (values.local) {
    const root = await inRepo(() => checkoutRoot(io.cwd, git))
    return (await listRuns(root, {}, { git })).filter(keep).slice(0, limit).map(shown)
  }
  const reader = await open(io.cwd, git)
  const cards: RunCard[] = []
  // Newest first, and no further than the cap: the cards past it are never read.
  for (const { person, id } of await runEntries(reader)) {
    if (cards.length >= limit) break
    const card = parseRunCard((await reader.read(`${RUNS_DIR}/${person}/${runCardFile(id)}`)) ?? '')
    if (!card || !keep(card)) continue
    cards.push(card)
  }
  return cards.map(shown)
}

/** The two flags either read takes: where it reads, and how much it prints. */
const READ_FLAGS = { local: { type: 'boolean' }, full: { type: 'boolean' } } as const

const COMMANDS: Record<string, Command> = {
  async skills(args, io, git) {
    const { values } = parse(args, { days: { type: 'string' }, local: { type: 'boolean' } }, 0)
    if (values.days !== undefined && (!/^\d+$/.test(values.days) || Number(values.days) < 1)) throw new Usage(`--days takes a whole number above 0, got ${values.days}`)
    const since = Date.now() - Number(values.days ?? 30) * 86_400_000
    if (values.local) {
      const root = await inRepo(() => checkoutRoot(io.cwd, git))
      const files = resolveLogsDeps({ git })
      return skillUseOf({ list: dir => files.list(dir), read: path => files.read(path).catch(() => undefined) }, await runsPath(root, git), since)
    }
    const reader = await open(io.cwd, git)
    return skillUseOf({ list: dir => reader.list(dir), read: path => reader.read(path) }, RUNS_DIR, since)
  },
  async people(args, io, git) {
    const { values } = parse(args, { days: { type: 'string' }, local: { type: 'boolean' } }, 0)
    if (values.days !== undefined && (!/^\d+$/.test(values.days) || Number(values.days) < 1)) throw new Usage(`--days takes a whole number above 0, got ${values.days}`)
    const since = Date.now() - Number(values.days ?? 30) * 86_400_000
    const me = (await git(['config', 'user.email'], io.cwd).catch(() => '')).trim() || undefined
    // The main branch's commits, newest first: the default branch as origin names it, else what is checked out.
    const main = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], io.cwd).catch(() => '')).trim() || 'HEAD'
    const commits = readCommitLines(await git(['log', main, '-n', '5000', '--format=%ae%x09%an%x09%at'], io.cwd).catch(() => ''))
    if (values.local) {
      const root = await inRepo(() => checkoutRoot(io.cwd, git))
      const files = resolveLogsDeps({ git })
      return peopleOf({ list: dir => files.list(dir), read: path => files.read(path).catch(() => undefined) }, await runsPath(root, git), since, me, commits)
    }
    const reader = await open(io.cwd, git)
    return peopleOf({ list: dir => reader.list(dir), read: path => reader.read(path) }, RUNS_DIR, since, me, commits)
  },
  async show(args, io, git) {
    const { values, positionals } = parse(args, READ_FLAGS, 1)
    const id = runIdArg(positionals[0]!)
    let card: RunCard | undefined
    let diary: ReturnType<typeof parseDiary> = []
    if (values.local) {
      const root = await inRepo(() => checkoutRoot(io.cwd, git))
      card = await findRun(root, id, { git })
      diary = card ? ((await readDiary(root, id, { git })) ?? []) : []
    } else {
      const reader = await open(io.cwd, git)
      const entry = (await runEntries(reader)).find(e => e.id === id)
      card = entry ? parseRunCard((await reader.read(`${RUNS_DIR}/${entry.person}/${runCardFile(id)}`)) ?? '') : undefined
      if (entry && card) diary = parseDiary((await reader.read(`${RUNS_DIR}/${entry.person}/${runDiaryFile(id)}`)) ?? '')
    }
    if (!card) throw noRun(id)
    return values.full ? { ...card, diary } : { ...publicCard(card), diary: agentLines(diary) }
  },

  async delete(args, io, git) {
    const { positionals } = parse(args, {}, 1)
    const id = runIdArg(positionals[0]!)
    const root = await inRepo(() => checkoutRoot(io.cwd, git))
    // The run is looked for inside the write cycle, after it synced the checkout: a run another
    // machine recorded is deletable here, and one that is nowhere commits nothing.
    const written = await deleteRun(root, id, { git })
    if (!written.ok && !written.committed) throw new Refused({ ok: false, reason: 'write-failed', id, detail: written.error }, written.error)
    if (written.ok && !written.changed) throw noRun(id)
    return { ok: true, id }
  },

  async patch(args, io, git) {
    const { values, positionals } = parse(args, { branch: { type: 'string' }, pr: { type: 'string' }, 'pr-url': { type: 'string' }, landed: { type: 'string' }, from: { type: 'string' } }, 1)
    const id = runIdArg(positionals[0]!)
    if ((values.pr === undefined) !== (values['pr-url'] === undefined)) throw new Usage('--pr and --pr-url go together')
    if (values.pr !== undefined && !/^\d+$/.test(values.pr)) throw new Usage(`--pr takes the pull request's number, got ${values.pr}`)
    if ((values.landed === undefined) !== (values.from === undefined)) throw new Usage('--landed and --from go together')
    for (const commit of [values.landed, values.from]) if (commit !== undefined && !/^[0-9a-f]{40}$/.test(commit)) throw new Usage(`--landed and --from take full commit ids, got ${commit}`)
    if (values.landed !== undefined && values.branch !== undefined) throw new Usage('--landed removes the branch: it does not go with --branch')
    const patch: RunPatch = {
      ...(values.branch !== undefined ? { branch: values.branch } : {}),
      ...(values.pr !== undefined ? { pr: { number: Number(values.pr), url: values['pr-url']! } } : {}),
      ...(values.landed !== undefined ? { landed: { commit: values.landed, from: values.from! } } : {}),
    }
    if (Object.keys(patch).length === 0) throw new Usage('patch needs --branch, --pr or --landed')
    const root = await inRepo(() => checkoutRoot(io.cwd, git))
    if (await patchRun(root, id, patch, { git })) return { ok: true, id }
    // Not patched: the cycle synced the checkout first, so a run it does not hold is no run at all.
    if (!(await runFiles(root, id, { git }))) throw noRun(id)
    throw new Refused({ ok: false, reason: 'write-failed', id }, 'the patch did not land')
  },
}

function runIdArg(id: string): string {
  if (!isRunId(id)) throw new Usage(`not a run id: ${id}`)
  return id
}

function noRun(id: string): Refused {
  return new Refused({ ok: false, reason: 'no-run', id }, `no run is named ${id}`)
}

/** Every run on the branch by person and id, newest first, from the directory listings alone. */
async function runEntries(reader: BranchReader): Promise<Array<{ person: string; id: string }>> {
  const entries: Array<{ person: string; id: string }> = []
  for (const person of await reader.list(RUNS_DIR)) {
    for (const name of await reader.list(`${RUNS_DIR}/${person}`)) {
      const id = runIdOfFile(name)
      if (id !== undefined) entries.push({ person, id })
    }
  }
  return newestFirst(entries)
}

/** The branch opened for reading, from wherever the command runs; outside a repo, a refusal. */
async function open(cwd: string, git: GitRunner): Promise<BranchReader> {
  await inRepo(() => checkoutRoot(cwd, git))
  return openBranchReader(cwd, DATA_BRANCH, { git })
}

function limitArg(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Usage(`--limit takes a whole number above 0, got ${value}`)
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

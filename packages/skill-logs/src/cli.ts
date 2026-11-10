import { GIT_FAILED, Refused, UsageError, inRepo, nodeBranchFileFs, nodeGitRunner, openProjectReader, parseCommandArgs, runCommandLine, runsRootOf, type Command, type GitRunner } from '@openagt/agent-data'
import { RUNS_DIR } from './names.js'
import { agentLines, isRunId, publicCard, type ListedRun, type RunCard, type RunPatch } from './run.js'
import { deleteRun, patchRun, runFiles, runsPath } from './store.js'
import { findEntry, readCard, readRunDiary, runEntries, type RecordsReader } from './records.js'
import { peopleOf, readCommitLines } from './people.js'
import { skillUseOf } from './skill-use.js'

/**
 * The command line over the package: the reads a daemon's pages do, for an agent (and a person)
 * in a shell, in any clone of the repository. An agent only reads: its run is recorded by the
 * process that ran it, not by the agent.
 *
 * A dashboard that shows the runs reads and changes them through the same command, so it needs
 * no code of this package: `--local` reads this machine's copy, the directory the writer writes
 * to, with no fetch (fast enough to poll), `--full` prints the whole record (the writer's `caller`
 * key, every diary line), and `delete` / `patch` are its Delete and Open-PR buttons, written
 * through that directory like the writer's own records.
 *
 * It answers as every OpenAgent command does (`runCommandLine`); a refusal here is a rule saying
 * no: there is no such run.
 *
 * Reads of a shared project go to origin's copy of its branch, fetched once, so a command sees
 * every run every machine pushed; a project kept on this machine reads its directory in the
 * personal folder. This machine's copy is read only with `--local` and written only by `delete`
 * and `patch`.
 */

/** How many runs the bare command prints unless told otherwise: enough to see what happened lately, not the whole history. */
export const DEFAULT_LIMIT = 20

export const USAGE = `usage: logs [command]

  (no command) [--branch <name>] [--limit N]
                                     the runs, newest first (the newest ${DEFAULT_LIMIT} unless --limit says
                                     otherwise), each with the person it is kept under; --branch keeps
                                     the runs on one branch
  show <id>                          one run: its card, and what the agent said, its result,
                                     how it ended, what it cost

  For a dashboard that shows the runs, not for an agent:
  --local                            with either read: read this machine's copy, no fetch from origin
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

/** Run the CLI: `argv` is everything after the program name. Resolves to the exit code. */
export function runCli(argv: string[], io: CliIo, git: GitRunner = nodeGitRunner()): Promise<number> {
  return runCommandLine(argv, io, { usage: USAGE, commands: COMMANDS, bare: list, failure: GIT_FAILED }, io, git)
}

/** The bare command: the runs, newest first, filtered and capped. */
const list: Command<[CliIo, GitRunner]> = async (args, io, git) => {
  const { values } = parseCommandArgs(args, { branch: { type: 'string' }, limit: { type: 'string' }, ...READ_FLAGS }, 0)
  const limit = values.limit === undefined ? DEFAULT_LIMIT : wholeAbove0('--limit', values.limit)
  const keep = (card: RunCard): boolean => values.branch === undefined || card.branch === values.branch
  // Each card with the person it is kept under, whichever way it is printed.
  const shown = ({ person, ...card }: ListedRun) => ({ ...(values.full ? card : publicCard(card)), person })
  const { reader, dir } = await records(io.cwd, values.local, git)
  const cards: ListedRun[] = []
  // Newest first, and no further than the cap: the cards past it are never read.
  for (const run of await runEntries(reader, dir)) {
    if (cards.length >= limit) break
    const card = await readCard(reader, dir, run)
    if (!card || !keep(card)) continue
    cards.push({ ...card, person: run.person })
  }
  return cards.map(shown)
}

/** The two flags either read takes: where it reads, and how much it prints. */
const READ_FLAGS = { local: { type: 'boolean' }, full: { type: 'boolean' } } as const

/** The flags of the reads of the last days, `people` and `skills`: how many days, and where they read. */
const DAYS_FLAGS = { days: { type: 'string' }, local: { type: 'boolean' } } as const

const COMMANDS: Record<string, Command<[CliIo, GitRunner]>> = {
  async skills(args, io, git) {
    const { values } = parseCommandArgs(args, DAYS_FLAGS, 0)
    const since = sinceDays(values.days)
    const { reader, dir } = await records(io.cwd, values.local, git)
    return skillUseOf(reader, dir, since)
  },
  async people(args, io, git) {
    const { values } = parseCommandArgs(args, DAYS_FLAGS, 0)
    const since = sinceDays(values.days)
    const me = (await git(['config', 'user.email'], io.cwd).catch(() => '')).trim() || undefined
    // The main branch's commits, newest first: the default branch as origin names it, else what is checked out.
    const main = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], io.cwd).catch(() => '')).trim() || 'HEAD'
    const commits = readCommitLines(await git(['log', main, '-n', '5000', '--format=%ae%x09%an%x09%at'], io.cwd).catch(() => ''))
    const { reader, dir } = await records(io.cwd, values.local, git)
    return peopleOf(reader, dir, since, me, commits)
  },
  async show(args, io, git) {
    const { values, positionals } = parseCommandArgs(args, READ_FLAGS, 1)
    const id = runIdArg(positionals[0]!)
    const { reader, dir } = await records(io.cwd, values.local, git)
    const run = await findEntry(reader, dir, id)
    const card = run && (await readCard(reader, dir, run))
    if (!run || !card) throw noRun(id)
    const diary = await readRunDiary(reader, dir, run)
    return values.full ? { ...card, diary } : { ...publicCard(card), diary: agentLines(diary) }
  },

  async delete(args, io, git) {
    const { positionals } = parseCommandArgs(args, {}, 1)
    const id = runIdArg(positionals[0]!)
    const root = await inRepo(() => runsRootOf(io.cwd, git))
    // The run is looked for inside the write cycle, after it synced the checkout: a run another
    // machine recorded is deletable here, and one that is nowhere commits nothing.
    const written = await deleteRun(root, id, { git })
    if (!written.ok && !written.committed) throw new Refused({ ok: false, reason: 'write-failed', id, detail: written.error }, written.error)
    if (written.ok && !written.changed) throw noRun(id)
    return { ok: true, id }
  },

  async patch(args, io, git) {
    const { values, positionals } = parseCommandArgs(args, { branch: { type: 'string' }, pr: { type: 'string' }, 'pr-url': { type: 'string' }, landed: { type: 'string' }, from: { type: 'string' } }, 1)
    const id = runIdArg(positionals[0]!)
    if ((values.pr === undefined) !== (values['pr-url'] === undefined)) throw new UsageError('--pr and --pr-url go together')
    if (values.pr !== undefined && !/^\d+$/.test(values.pr)) throw new UsageError(`--pr takes the pull request's number, got ${values.pr}`)
    if ((values.landed === undefined) !== (values.from === undefined)) throw new UsageError('--landed and --from go together')
    for (const commit of [values.landed, values.from]) if (commit !== undefined && !/^[0-9a-f]{40}$/.test(commit)) throw new UsageError(`--landed and --from take full commit ids, got ${commit}`)
    if (values.landed !== undefined && values.branch !== undefined) throw new UsageError('--landed removes the branch: it does not go with --branch')
    const patch: RunPatch = {
      ...(values.branch !== undefined ? { branch: values.branch } : {}),
      ...(values.pr !== undefined ? { pr: { number: Number(values.pr), url: values['pr-url']! } } : {}),
      ...(values.landed !== undefined ? { landed: { commit: values.landed, from: values.from! } } : {}),
    }
    if (Object.keys(patch).length === 0) throw new UsageError('patch needs --branch, --pr or --landed')
    const root = await inRepo(() => runsRootOf(io.cwd, git))
    if (await patchRun(root, id, patch, { git })) return { ok: true, id }
    // Not patched: the cycle synced the checkout first, so a run it does not hold is no run at all.
    if (!(await runFiles(root, id, { git }))) throw noRun(id)
    throw new Refused({ ok: false, reason: 'write-failed', id }, 'the patch did not land')
  },
}

function runIdArg(id: string): string {
  if (!isRunId(id)) throw new UsageError(`not a run id: ${id}`)
  return id
}

function noRun(id: string): Refused {
  return new Refused({ ok: false, reason: 'no-run', id }, `no run is named ${id}`)
}

/**
 * The records a read goes through, and where the runs are in them: origin's copy, fetched once,
 * or with `--local` this machine's, the writer's checkout read where it lies, with no fetch. From
 * wherever the command runs, in a project or among the sessions with no project (the sessions
 * home); outside both, a refusal.
 */
async function records(cwd: string, local: boolean | undefined, git: GitRunner): Promise<{ reader: RecordsReader; dir: string }> {
  const root = await inRepo(() => runsRootOf(cwd, git))
  if (!local) return { reader: await openProjectReader(cwd, { git }), dir: RUNS_DIR }
  const files = nodeBranchFileFs()
  return { reader: { list: files.list, read: path => files.read(path).catch(() => undefined) }, dir: await runsPath(root, git) }
}

/** A flag's value that must be a whole number above 0: `--limit`, `--days`. */
function wholeAbove0(flag: string, value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new UsageError(`${flag} takes a whole number above 0, got ${value}`)
  return Number(value)
}

/** When the days a read looks back over began: `--days` of them, 30 unless said. */
function sinceDays(days: string | undefined): number {
  return Date.now() - (days === undefined ? 30 : wholeAbove0('--days', days)) * 86_400_000
}

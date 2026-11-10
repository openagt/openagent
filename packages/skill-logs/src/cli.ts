import { GIT_FAILED, Refused, UsageError, inRepo, nodeGitRunner, openProjectReader, parseCommandArgs, runCommandLine, runsRootOf, type Command, type ProjectReader, type GitRunner } from '@openagt/agent-data'
import { RUNS_DIR } from './names.js'
import { agentLines, isRunId, publicCard, type AnyDiaryLine, type ListedRun, type RunCard, type RunPatch } from './run.js'
import { deleteRun, findRun, listRuns, patchRun, readDiary, resolveLogsDeps, runFiles, runsPath } from './store.js'
import { findEntry, readCard, readRunDiary, runEntries } from './records.js'
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
  const limit = values.limit === undefined ? DEFAULT_LIMIT : limitArg(values.limit)
  const keep = (card: RunCard): boolean => values.branch === undefined || card.branch === values.branch
  // Each card with the person it is kept under, whichever way it is printed.
  const shown = ({ person, ...card }: ListedRun) => ({ ...(values.full ? card : publicCard(card)), person })
  if (values.local) {
    const root = await inRepo(() => runsRootOf(io.cwd, git))
    return (await listRuns(root, {}, { git })).filter(keep).slice(0, limit).map(shown)
  }
  const reader = await open(io.cwd, git)
  const cards: ListedRun[] = []
  // Newest first, and no further than the cap: the cards past it are never read.
  for (const run of await runEntries(reader, RUNS_DIR)) {
    if (cards.length >= limit) break
    const card = await readCard(reader, RUNS_DIR, run)
    if (!card || !keep(card)) continue
    cards.push({ ...card, person: run.person })
  }
  return cards.map(shown)
}

/** The two flags either read takes: where it reads, and how much it prints. */
const READ_FLAGS = { local: { type: 'boolean' }, full: { type: 'boolean' } } as const

const COMMANDS: Record<string, Command<[CliIo, GitRunner]>> = {
  async skills(args, io, git) {
    const { values } = parseCommandArgs(args, { days: { type: 'string' }, local: { type: 'boolean' } }, 0)
    if (values.days !== undefined && (!/^\d+$/.test(values.days) || Number(values.days) < 1)) throw new UsageError(`--days takes a whole number above 0, got ${values.days}`)
    const since = Date.now() - Number(values.days ?? 30) * 86_400_000
    if (values.local) {
      const root = await inRepo(() => runsRootOf(io.cwd, git))
      const files = resolveLogsDeps({ git })
      return skillUseOf({ list: dir => files.list(dir), read: path => files.read(path).catch(() => undefined) }, await runsPath(root, git), since)
    }
    const reader = await open(io.cwd, git)
    return skillUseOf({ list: dir => reader.list(dir), read: path => reader.read(path) }, RUNS_DIR, since)
  },
  async people(args, io, git) {
    const { values } = parseCommandArgs(args, { days: { type: 'string' }, local: { type: 'boolean' } }, 0)
    if (values.days !== undefined && (!/^\d+$/.test(values.days) || Number(values.days) < 1)) throw new UsageError(`--days takes a whole number above 0, got ${values.days}`)
    const since = Date.now() - Number(values.days ?? 30) * 86_400_000
    const me = (await git(['config', 'user.email'], io.cwd).catch(() => '')).trim() || undefined
    // The main branch's commits, newest first: the default branch as origin names it, else what is checked out.
    const main = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], io.cwd).catch(() => '')).trim() || 'HEAD'
    const commits = readCommitLines(await git(['log', main, '-n', '5000', '--format=%ae%x09%an%x09%at'], io.cwd).catch(() => ''))
    if (values.local) {
      const root = await inRepo(() => runsRootOf(io.cwd, git))
      const files = resolveLogsDeps({ git })
      return peopleOf({ list: dir => files.list(dir), read: path => files.read(path).catch(() => undefined) }, await runsPath(root, git), since, me, commits)
    }
    const reader = await open(io.cwd, git)
    return peopleOf({ list: dir => reader.list(dir), read: path => reader.read(path) }, RUNS_DIR, since, me, commits)
  },
  async show(args, io, git) {
    const { values, positionals } = parseCommandArgs(args, READ_FLAGS, 1)
    const id = runIdArg(positionals[0]!)
    let card: RunCard | undefined
    let diary: AnyDiaryLine[] = []
    if (values.local) {
      const root = await inRepo(() => runsRootOf(io.cwd, git))
      card = await findRun(root, id, { git })
      diary = card ? ((await readDiary(root, id, { git })) ?? []) : []
    } else {
      const reader = await open(io.cwd, git)
      const run = await findEntry(reader, RUNS_DIR, id)
      card = run && (await readCard(reader, RUNS_DIR, run))
      if (run && card) diary = await readRunDiary(reader, RUNS_DIR, run)
    }
    if (!card) throw noRun(id)
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

/** The project's data opened for reading, from wherever the command runs, or the sessions with no project's, from the sessions home; outside both, a refusal. */
async function open(cwd: string, git: GitRunner): Promise<ProjectReader> {
  await inRepo(() => runsRootOf(cwd, git))
  return openProjectReader(cwd, { git })
}

function limitArg(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new UsageError(`--limit takes a whole number above 0, got ${value}`)
  return Number(value)
}

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { nodeBranchFileFs, nodeGitRunner, projectDataDir, withProjectData, type BranchFileFs, type CommitMessage, type FileBranchWrite, type GitRunner } from '@openagt/agent-data'
import {
  RUNS_DIR,
  type ListedRun,
  formatDiary,
  formatRunCard,
  parseDiary,
  parseRunCard,
  personDir,
  runCardFile,
  runDiaryFile,
  isRunId,
  type AnyDiaryLine,
  type RunCard,
  type RunPatch,
} from './record.js'
import { findEntry, readCard, runEntries, type RecordsReader } from './records.js'

// Where the runs live: `agents/<who>/<id>.json` and `<id>.jsonl` in the project's data directory
// (its directory in the personal folder, or the checkout of its `agent-data` branch when the
// project is shared). This module is a long-lived process's side: it reads that directory,
// walking it as `records.ts` does, and writes through the caller's funnel. The `logs` command
// reads with `records.ts` alone, through whichever copy of the records it is asked for.

/** The plain-file seams an operation on the branch's files needs. */
export type RecordFiles = BranchFileFs

/**
 * A caller's write funnel: apply `op` to a checkout of the branch, commit, push. The default is
 * the persistent checkout's serialized cycle; a test's fake stands in.
 */
export type RecordFunnel = (root: string, message: CommitMessage, op: (dir: string) => Promise<void>) => Promise<FileBranchWrite>

/** Injectable seams so every operation is unit-testable off disk and git; production takes the defaults. */
export interface RecordDeps extends Partial<RecordFiles> {
  funnel?: RecordFunnel
  git?: GitRunner
}

/** The default funnel: the project's data write. */
export const recordFunnel: RecordFunnel = (root, message, op) => withProjectData(root, message, op)

/** Fill in whatever a caller left out, so an operation reads the same way in tests and out. */
export function resolveRecordDeps(deps: RecordDeps): RecordFiles & { funnel: RecordFunnel; git: GitRunner } {
  const fs = nodeBranchFileFs()
  return {
    read: deps.read ?? fs.read,
    write: deps.write ?? fs.write,
    remove: deps.remove ?? fs.remove,
    list: deps.list ?? fs.list,
    funnel: deps.funnel ?? recordFunnel,
    git: deps.git ?? nodeGitRunner(),
  }
}

/** The runs directory inside a checkout of the branch. */
function runsDir(checkout: string): string {
  return join(checkout, RUNS_DIR)
}

/** The project's runs directory, from anywhere in the project's clone. */
export async function runsPath(root: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  return runsDir(await projectDataDir(root, { git }))
}

/** The checkout's files as a reader of the records: a file that cannot be read reads as absent. */
function asRecords(r: RecordFiles): RecordsReader {
  return { list: dir => r.list(dir), read: path => r.read(path).catch(() => undefined) }
}

/** The card and diary paths of one run inside a checkout, searched across every person's directory; `undefined` when it is nowhere. */
async function locate(checkout: string, id: string, r: RecordFiles): Promise<{ card: string; diary: string } | undefined> {
  if (!isRunId(id)) return undefined
  const dir = runsDir(checkout)
  const run = await findEntry(asRecords(r), dir, id)
  return run && { card: join(dir, run.person, runCardFile(id)), diary: join(dir, run.person, runDiaryFile(id)) }
}

/**
 * Every run of the project, newest first, off the persistent checkout, each with the person it is
 * kept under: each person's directory is read, a card that does not parse is skipped. `since`
 * (epoch ms) keeps only the runs started at or after it. Never throws: a missing directory is no runs.
 */
export async function listRuns(root: string, opts: { since?: number } = {}, deps: RecordDeps = {}): Promise<ListedRun[]> {
  const r = resolveRecordDeps(deps)
  const dir = await runsPath(root, r.git)
  const records = asRecords(r)
  const cards: ListedRun[] = []
  for (const run of await runEntries(records, dir)) {
    const card = await readCard(records, dir, run)
    if (!card) continue
    if (opts.since !== undefined && !(Date.parse(card.startedAt) >= opts.since)) continue
    cards.push({ ...card, person: run.person })
  }
  return cards
}

/** Where one run's two files sit on the persistent checkout, or `undefined` when the run is not there. */
export async function runFiles(root: string, id: string, deps: RecordDeps = {}): Promise<{ card: string; diary: string } | undefined> {
  const r = resolveRecordDeps(deps)
  return locate(await projectDataDir(root, { git: r.git }), id, r)
}

/** One run's card, or `undefined` when there is no such run or its card does not parse. */
export async function findRun(root: string, id: string, deps: RecordDeps = {}): Promise<RunCard | undefined> {
  const r = resolveRecordDeps(deps)
  const files = await runFiles(root, id, deps)
  return files ? parseRunCard(await r.read(files.card).catch(() => '')) : undefined
}

/** One run's diary, every line: `[]` for a run with no diary file, `undefined` for no such run. */
export async function readDiary(root: string, id: string, deps: RecordDeps = {}): Promise<AnyDiaryLine[] | undefined> {
  const r = resolveRecordDeps(deps)
  const files = await runFiles(root, id, deps)
  if (!files) return undefined
  return parseDiary(await r.read(files.diary).catch(() => ''))
}

/**
 * git's `user.email` in `root` by the person's own settings alone, without the ones the process's
 * environment adds (`GIT_CONFIG_*`). A run that works as an account of OpenAgent's has that
 * account's name put on the commits made in its project through them: whom the commits are by,
 * not who started the run. Empty where the person's own settings name nobody, or git cannot say.
 */
function ownEmail(root: string): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_CONFIG_(COUNT$|KEY_|VALUE_)/.test(key)))
  return new Promise(resolve => execFile('git', ['config', 'user.email'], { cwd: root, env, timeout: 10_000 }, (err, stdout) => resolve(err ? '' : String(stdout).trim())))
}

/**
 * Record a run: its card and its diary, as one commit, under the directory of the person who
 * started it, the one the repository commits as by the person's own settings (an account the run
 * works as is not that person; where those settings name nobody, whoever git commits as there) — or where the run already sits, when it does, so a run recorded again
 * (its ending, written by a later process) stays in one place. Never throws; the funnel's outcome
 * says whether the commit landed and whether it was pushed.
 */
export async function writeRun(root: string, card: RunCard, diary: readonly AnyDiaryLine[], deps: RecordDeps = {}): Promise<FileBranchWrite> {
  const r = resolveRecordDeps(deps)
  if (!isRunId(card.id)) return { ok: false, committed: false, error: `not a run id: ${card.id}` }
  const person = personDir((await ownEmail(root)) || (await r.git(['config', 'user.email'], root).catch(() => '')))
  return r.funnel(root, `logs: record run ${card.id}`, async checkout => {
    const existing = await locate(checkout, card.id, r)
    const files = existing ?? {
      card: join(runsDir(checkout), person, runCardFile(card.id)),
      diary: join(runsDir(checkout), person, runDiaryFile(card.id)),
    }
    await r.write(files.card, formatRunCard(card))
    await r.write(files.diary, formatDiary(diary))
  })
}

/**
 * Patch a late fact onto a run's card — the branch its work landed on, the pull request — as one
 * commit. True when the card now carries it, committed; a push that could not go out rides the
 * next cycle. False when there is no such run.
 */
export async function patchRun(root: string, id: string, patch: RunPatch, deps: RecordDeps = {}): Promise<boolean> {
  const r = resolveRecordDeps(deps)
  let patched = false
  const result = await r.funnel(root, `logs: patch run ${id}`, async checkout => {
    patched = false
    const files = await locate(checkout, id, r)
    const card = files ? parseRunCard(await r.read(files.card).catch(() => '')) : undefined
    if (!files || !card) return
    const { landed, ...facts } = patch
    const { branch: _gone, ...branchless } = card
    const next = landed ? { ...branchless, ...facts, caller: { baseCommit: landed.from, ...card.caller, landed: landed.commit } } : { ...card, ...facts }
    await r.write(files.card, formatRunCard(next))
    patched = true
  })
  return patched && (result.ok || result.committed)
}

/**
 * Delete a run as one commit: its card, its diary, and any other file named after its id that
 * another package keeps beside them (`<id>.<anything>`). A run that is not there is a landed no-op.
 */
export async function deleteRun(root: string, id: string, deps: RecordDeps = {}): Promise<FileBranchWrite> {
  const r = resolveRecordDeps(deps)
  return r.funnel(root, `logs: delete run ${id}`, async checkout => {
    const files = await locate(checkout, id, r)
    if (!files) return
    const dir = dirname(files.card)
    for (const name of await r.list(dir)) if (name.startsWith(`${id}.`)) await r.remove(join(dir, name))
  })
}

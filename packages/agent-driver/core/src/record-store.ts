import { execFile } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { nodeBranchFileFs, projectDataDir, withProjectData, type BranchFileFs, type CommitMessage, type FileBranchWrite } from '@openagt/store-filesystem'
import { nodeGitRunner, sessionsHomeOf } from '@openagt/git-branches'
import { noreplyEmail, teamCallerOf, type GitRunner, type TeamCaller } from '@openagt/hooks'
import {
  COPIES_DIR,
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
//
// A session with no project is recorded in the sessions home, and again in the data of each
// project it has a copy of (`COPIES_DIR`), so that project's logs have it too: every write, patch
// and delete of its record goes to each of them after the home's.

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
  /**
   * The folders of the projects on this computer's list: a session with no project is recorded in
   * the data of each of them it has a copy of, too. Without it, in the sessions home alone.
   */
  projects?: () => Promise<readonly string[]>
}

/** The default funnel: the project's data write. */
export const recordFunnel: RecordFunnel = (root, message, op) => withProjectData(root, message, op)

/** Fill in whatever a caller left out, so an operation reads the same way in tests and out. */
export function resolveRecordDeps(deps: RecordDeps): RecordFiles & { funnel: RecordFunnel; git: GitRunner; projects?: () => Promise<readonly string[]> } {
  const fs = nodeBranchFileFs()
  return {
    ...(deps.projects ? { projects: deps.projects } : {}),
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

/** Whom a run was started for on a machine shared by a team, as its runner's mark keeps it. */
function startedForOf(card: RunCard): TeamCaller | undefined {
  const mark = card.caller?.['runner']
  return mark && typeof mark === 'object' ? teamCallerOf((mark as Record<string, unknown>)['startedFor']) : undefined
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
  // On a machine shared by a team, the run is its person's, under their address at GitHub: not the machine's git user's.
  const startedFor = startedForOf(card)
  const person = personDir(startedFor ? noreplyEmail(startedFor) : (await ownEmail(root)) || (await r.git(['config', 'user.email'], root).catch(() => '')))
  kept.delete(root)
  let keptUnder = person
  const written = await r.funnel(root, `logs: record run ${card.id}`, async checkout => {
    const existing = await locate(checkout, card.id, r)
    const files = existing ?? {
      card: join(runsDir(checkout), person, runCardFile(card.id)),
      diary: join(runsDir(checkout), person, runDiaryFile(card.id)),
    }
    keptUnder = basename(dirname(files.card))
    await r.write(files.card, formatRunCard(card))
    await r.write(files.diary, formatDiary(diary))
  })
  for (const copy of await copiedInto(root, card, r)) {
    await r.funnel(copy, `logs: record session ${card.id}`, async checkout => {
      const dir = join(checkout, COPIES_DIR, (await copyEntry(checkout, card.id, r)) ?? keptUnder)
      await r.write(join(dir, runCardFile(card.id)), formatRunCard(card))
      await r.write(join(dir, runDiaryFile(card.id)), formatDiary(diary))
    })
  }
  return written
}

/** Two folders the same once each is made absolute and loses a trailing separator. */
const sameFolder = (a: string, b: string): boolean => resolve(a) === resolve(b)

/**
 * The projects a session with no project is recorded in beside the sessions home: each on this
 * computer's list it has a copy of, by the folder the copy was made from. None for a run in a
 * project, nor without the list.
 */
async function copiedInto(root: string, card: RunCard, r: { projects?: () => Promise<readonly string[]> }): Promise<string[]> {
  if (!r.projects || (await sessionsHomeOf(root)) === undefined) return []
  const repos = (card.caller?.['runner'] as { repos?: unknown } | undefined)?.repos
  if (!Array.isArray(repos) || repos.length === 0) return []
  const projects = await r.projects().catch((): readonly string[] => [])
  return projects.filter(project => repos.some(repo => typeof repo?.from === 'string' && sameFolder(repo.from, project)))
}

/** The person a session's copy of its record is kept under in a project's data, when it is there. */
async function copyEntry(checkout: string, id: string, r: RecordFiles): Promise<string | undefined> {
  return (await findEntry(asRecords(r), join(checkout, COPIES_DIR), id))?.person
}

/**
 * Patch a late fact onto a run's card — the branch its work landed on, the pull request — as one
 * commit. True when the card now carries it, committed; a push that could not go out rides the
 * next cycle. False when there is no such run.
 */
export async function patchRun(root: string, id: string, patch: RunPatch, deps: RecordDeps = {}): Promise<boolean> {
  const r = resolveRecordDeps(deps)
  let patched: RunCard | undefined
  const result = await r.funnel(root, `logs: patch run ${id}`, async checkout => {
    patched = undefined
    const files = await locate(checkout, id, r)
    const card = files ? parseRunCard(await r.read(files.card).catch(() => '')) : undefined
    if (!files || !card) return
    const { landed, copyPrs, ...facts } = patch
    const { branch: _gone, ...branchless } = card
    const withFacts = landed ? { ...branchless, ...facts, caller: { baseCommit: landed.from, ...card.caller, landed: landed.commit } } : { ...card, ...facts }
    const next = copyPrs ? { ...withFacts, caller: { ...withFacts.caller, copyPrs } } : withFacts
    await r.write(files.card, formatRunCard(next))
    patched = next
  })
  kept.delete(root)
  const card: RunCard | undefined = patched
  if (card === undefined) return false
  for (const copy of await copiedInto(root, card, r)) {
    await r.funnel(copy, `logs: patch session ${id}`, async checkout => {
      const person = await copyEntry(checkout, id, r)
      if (person !== undefined) await r.write(join(checkout, COPIES_DIR, person, runCardFile(id)), formatRunCard(card))
    })
  }
  return result.ok || result.committed
}

/**
 * Delete a run as one commit: its card, its diary, and any other file named after its id that
 * another package keeps beside them (`<id>.<anything>`). A run that is not there is a landed no-op.
 */
export async function deleteRun(root: string, id: string, deps: RecordDeps = {}): Promise<FileBranchWrite> {
  const r = resolveRecordDeps(deps)
  let card: RunCard | undefined
  const result = await r.funnel(root, `logs: delete run ${id}`, async checkout => {
    const files = await locate(checkout, id, r)
    if (!files) return
    card = parseRunCard(await r.read(files.card).catch(() => ''))
    await removeNamed(dirname(files.card), id, r)
  })
  kept.delete(root)
  const deleted: RunCard | undefined = card
  if (deleted === undefined) return result
  for (const copy of await copiedInto(root, deleted, r)) {
    await r.funnel(copy, `logs: delete session ${id}`, async checkout => {
      const person = await copyEntry(checkout, id, r)
      if (person !== undefined) await removeNamed(join(checkout, COPIES_DIR, person), id, r)
    })
  }
  return result
}

/** Every file in `dir` named after the run `id`: its card, its diary, and any other `<id>.<anything>`. */
async function removeNamed(dir: string, id: string, r: RecordFiles): Promise<void> {
  for (const name of await r.list(dir)) if (name.startsWith(`${id}.`)) await r.remove(join(dir, name))
}

/** How long a project's records, once read, answer the lists of them: a dashboard asks many lists at each poll. */
const RECORDS_KEPT_MS = 2_000

/** The records each project's last kept list read, and the runs that had a folder then. */
const kept = new Map<string, { at: number; records: Promise<ListedRun[]>; working: Set<string> }>()

/**
 * A project's runs as {@link listRuns} reads them, from the last read while it is fresh: for a reader
 * that lists them again and again. `working` are the runs with a folder now: one whose folder went
 * since that read was recorded a moment before it went, so the records are read again then, or its
 * row would blink out until the next read. A write through this module reads them again too.
 */
export function keptRuns(root: string, working: readonly string[]): Promise<ListedRun[]> {
  const now = new Set(working)
  const last = kept.get(root)
  const gone = last !== undefined && [...last.working].some(id => !now.has(id))
  if (last && !gone && Date.now() - last.at < RECORDS_KEPT_MS) {
    last.working = now
    return last.records
  }
  const records = listRuns(root).catch((): ListedRun[] => [])
  kept.set(root, { at: Date.now(), records, working: now })
  return records
}

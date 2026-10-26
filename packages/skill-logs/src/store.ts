import { dirname, join } from 'node:path'
import { DATA_BRANCH, fileBranchPath, nodeBranchFileFs, nodeGitRunner, withFileBranch, type BranchFileFs, type CommitMessage, type FileBranchWrite, type GitRunner } from '@openagt/agent-data'
import { RUNS_DIR } from './names.js'
import {
  type ListedRun,
  formatDiary,
  formatRunCard,
  newestFirst,
  parseDiary,
  parseRunCard,
  personDir,
  runCardFile,
  runDiaryFile,
  runIdOfFile,
  isRunId,
  type AnyDiaryLine,
  type RunCard,
  type RunPatch,
} from './run.js'

// Where the runs live, bound to the branch: `agents/<who>/<id>.json` and `<id>.jsonl` at the
// root of the `agent-data` branch of the project's repository, checked out under
// `.branches/agent-data` for a long-lived process. This module is that process's side: it reads
// the checkout and writes through the caller's funnel. The command an agent runs reads the
// branch off origin instead (`cli`), holding no checkout.

/** The plain-file seams an operation on the branch's files needs. */
export type LogsFiles = BranchFileFs

/**
 * A caller's write funnel: apply `op` to a checkout of the branch, commit, push. The default is
 * the persistent checkout's serialized cycle; a test's fake stands in.
 */
export type LogsFunnel = (root: string, message: CommitMessage, op: (dir: string) => Promise<void>) => Promise<FileBranchWrite>

/** Injectable seams so every operation is unit-testable off disk and git; production takes the defaults. */
export interface LogsDeps extends Partial<LogsFiles> {
  funnel?: LogsFunnel
  git?: GitRunner
  log?: (message: string) => void
}

/** The default funnel: the persistent checkout's write cycle, on the `agent-data` branch. */
export const logsFunnel: LogsFunnel = (root, message, op) => withFileBranch(root, DATA_BRANCH, message, op)

/** Fill in whatever a caller left out, so an operation reads the same way in tests and out. */
export function resolveLogsDeps(deps: LogsDeps): LogsFiles & { funnel: LogsFunnel; git: GitRunner; log: (message: string) => void } {
  const fs = nodeBranchFileFs()
  return {
    read: deps.read ?? fs.read,
    write: deps.write ?? fs.write,
    remove: deps.remove ?? fs.remove,
    list: deps.list ?? fs.list,
    funnel: deps.funnel ?? logsFunnel,
    git: deps.git ?? nodeGitRunner(),
    log: deps.log ?? (() => {}),
  }
}

/** The runs directory inside a checkout of the branch. */
function runsDir(checkout: string): string {
  return join(checkout, RUNS_DIR)
}

/** The persistent checkout's runs directory, from anywhere in the project's clone. */
export async function runsPath(root: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  return runsDir(await fileBranchPath(root, DATA_BRANCH, git))
}

/** The card and diary paths of one run inside a checkout, searched across every person's directory; `undefined` when it is nowhere. */
async function locate(checkout: string, id: string, r: Pick<LogsFiles, 'list'>): Promise<{ card: string; diary: string } | undefined> {
  if (!isRunId(id)) return undefined
  const dir = runsDir(checkout)
  for (const person of await r.list(dir)) {
    if ((await r.list(join(dir, person))).includes(runCardFile(id))) {
      return { card: join(dir, person, runCardFile(id)), diary: join(dir, person, runDiaryFile(id)) }
    }
  }
  return undefined
}

/**
 * Every run of the project, newest first, off the persistent checkout, each with the person it is
 * kept under: each person's directory is read, a card that does not parse is skipped. `since`
 * (epoch ms) keeps only the runs started at or after it. Never throws: a missing directory is no runs.
 */
export async function listRuns(root: string, opts: { since?: number } = {}, deps: LogsDeps = {}): Promise<ListedRun[]> {
  const r = resolveLogsDeps(deps)
  const dir = await runsPath(root, r.git)
  const cards: ListedRun[] = []
  for (const person of await r.list(dir)) {
    for (const name of await r.list(join(dir, person))) {
      if (runIdOfFile(name) === undefined) continue
      const card = parseRunCard(await r.read(join(dir, person, name)).catch(() => ''))
      if (!card) continue
      if (opts.since !== undefined && !(Date.parse(card.startedAt) >= opts.since)) continue
      cards.push({ ...card, person })
    }
  }
  return newestFirst(cards)
}

/** Where one run's two files sit on the persistent checkout, or `undefined` when the run is not there. */
export async function runFiles(root: string, id: string, deps: LogsDeps = {}): Promise<{ card: string; diary: string } | undefined> {
  const r = resolveLogsDeps(deps)
  return locate(await fileBranchPath(root, DATA_BRANCH, r.git), id, r)
}

/** One run's card, or `undefined` when there is no such run or its card does not parse. */
export async function findRun(root: string, id: string, deps: LogsDeps = {}): Promise<RunCard | undefined> {
  const r = resolveLogsDeps(deps)
  const files = await runFiles(root, id, deps)
  return files ? parseRunCard(await r.read(files.card).catch(() => '')) : undefined
}

/** One run's diary, every line: `[]` for a run with no diary file, `undefined` for no such run. */
export async function readDiary(root: string, id: string, deps: LogsDeps = {}): Promise<AnyDiaryLine[] | undefined> {
  const r = resolveLogsDeps(deps)
  const files = await runFiles(root, id, deps)
  if (!files) return undefined
  return parseDiary(await r.read(files.diary).catch(() => ''))
}

/**
 * Record a run: its card and its diary, as one commit, under the directory of the person the
 * repository commits as — or where the run already sits, when it does, so a run recorded again
 * (its ending, written by a later process) stays in one place. Never throws; the funnel's outcome
 * says whether the commit landed and whether it was pushed.
 */
export async function writeRun(root: string, card: RunCard, diary: readonly AnyDiaryLine[], deps: LogsDeps = {}): Promise<FileBranchWrite> {
  const r = resolveLogsDeps(deps)
  if (!isRunId(card.id)) return { ok: false, committed: false, error: `not a run id: ${card.id}` }
  const email = await r.git(['config', 'user.email'], root).catch(() => '')
  const person = personDir(email)
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
export async function patchRun(root: string, id: string, patch: RunPatch, deps: LogsDeps = {}): Promise<boolean> {
  const r = resolveLogsDeps(deps)
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
export async function deleteRun(root: string, id: string, deps: LogsDeps = {}): Promise<FileBranchWrite> {
  const r = resolveLogsDeps(deps)
  return r.funnel(root, `logs: delete run ${id}`, async checkout => {
    const files = await locate(checkout, id, r)
    if (!files) return
    const dir = dirname(files.card)
    for (const name of await r.list(dir)) if (name.startsWith(`${id}.`)) await r.remove(join(dir, name))
  })
}

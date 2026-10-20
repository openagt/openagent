import type { FileBranchWrite } from '@openagt/agent-data'
import { deleteRun, writeRun, type AnyDiaryLine, type LogsDeps, type RunCard } from '@openagt/skill-logs'

/**
 * A run in flight is a run record (#1774): the `logs` skill's card on the project's `agent-data`
 * branch, written before the agent is spawned with `status: running` and this tool's own mark
 * under `caller`, and written again when the run ends — same id, same file — with how it went.
 * One file for the run's whole life, and every machine that shares the branch reads the same
 * running cards (a scheduler counts them against its caps). No pid is held anywhere: a restart
 * loses nothing.
 *
 * A running card from another machine is that machine's: only its own sweep, or a person, changes
 * it. A machine that never comes back leaves its card running, on purpose: nothing here guesses that a run it cannot see is dead.
 */

/** How far a run takes its work when its agent finishes: a commit, its branch pushed, its pull request, or the request set to merge once its checks pass. */
export const PUBLISH_LEVELS = ['commit', 'branch', 'pr', 'merge'] as const
export type Publish = (typeof PUBLISH_LEVELS)[number]

export function isPublish(value: unknown): value is Publish {
  return (PUBLISH_LEVELS as readonly unknown[]).includes(value)
}

/** The word that takes a run's level away on a resume or a message (`--publish nothing`): from there on its prompt goes as written. */
export const NO_PUBLISH = 'nothing'

/**
 * A level a run is given part way, by a resume or a message (`--publish`, an inbox line's
 * `publish`): one of the levels, or `null` for {@link NO_PUBLISH}; any other word is no change.
 */
export function publishChange(word: string | undefined): Publish | null | undefined {
  return isPublish(word) ? word : word === NO_PUBLISH ? null : undefined
}

/** This tool's mark on a card, under `caller.runner`. */
export interface RunnerMark {
  /** The machine that started it. */
  host: string
  /** The run's process on that machine, while it runs. */
  pid?: number
  /** The prompt a fresh agent is given once the run ends done with a pull request, the run's id after it (`run --then`). */
  then?: string
  /** How far the run takes its work when its agent finishes (`run --publish`): a commit, the branch, its pull request, or the request set to merge; absent, only what its prompt asks. */
  publish?: Publish
  /** The run this one was started for, told when this one ends (`run --parent`). */
  parent?: string
  /** The branch this run's own branch started from (`run --base`); origin's default branch when absent. */
  base?: string
  /** The commit this run's own branch was made at: where the run's own work begins. Absent for a run given a branch that existed. */
  baseCommit?: string
  /** What the run was started for, as whoever started it names it (`run --for`): a thread on the git host, its address, so the next call there finds this run. */
  for?: string
  /** Who resumed the run last, and when (`run --resume --by`): a scheduler's row, which counts the run as its own from then on. Not kept past the next resume. */
  resumed?: { by: string; at: string }
}

/** The mark a card carries, or `undefined` for a run this tool did not start. */
export function runnerMark(card: RunCard): RunnerMark | undefined {
  const mark = card.caller?.['runner']
  if (!mark || typeof mark !== 'object') return undefined
  const { host, pid, then, publish, parent, base, baseCommit, for: started, resumed } = mark as Record<string, unknown>
  if (typeof host !== 'string') return undefined
  const by = resumed && typeof resumed === 'object' ? (resumed as Record<string, unknown>) : {}
  return { host, ...(typeof pid === 'number' ? { pid } : {}), ...lasting({ then, publish, parent, base, baseCommit, for: started }), ...(typeof by['by'] === 'string' && typeof by['at'] === 'string' ? { resumed: { by: by['by'], at: by['at'] } } : {}) }
}

/** What a mark keeps for the run's whole life, a resume included: its follow-up, its publish level, its parent, where it started, what it was started for. */
export function lasting(mark: { then?: unknown; publish?: unknown; parent?: unknown; base?: unknown; baseCommit?: unknown; for?: unknown }): Pick<RunnerMark, 'then' | 'publish' | 'parent' | 'base' | 'baseCommit' | 'for'> {
  return {
    ...(typeof mark.then === 'string' ? { then: mark.then } : {}),
    ...(isPublish(mark.publish) ? { publish: mark.publish } : {}),
    ...(typeof mark.parent === 'string' ? { parent: mark.parent } : {}),
    ...(typeof mark.base === 'string' ? { base: mark.base } : {}),
    ...(typeof mark.baseCommit === 'string' ? { baseCommit: mark.baseCommit } : {}),
    ...(typeof mark.for === 'string' ? { for: mark.for } : {}),
  }
}

/** The card a run starts with. */
export function markerCard(run: { id: string; startedAt: string; prompt: string; driver: string; model?: string; mark: RunnerMark }): RunCard {
  return {
    id: run.id,
    startedAt: run.startedAt,
    status: 'running',
    intent: run.prompt,
    driver: run.driver,
    ...(run.model !== undefined ? { model: run.model } : {}),
    // `host` as the run's live card has it too: a reader tells this machine's runs from another's by it.
    caller: { runner: run.mark, host: run.mark.host, ...forReaders(run.mark) },
  }
}

/**
 * What a reader of the card finds beside `host`, outside this tool's mark: the run's parent, the
 * branch it was started from when it was told one, the commit its own work begins at, which its
 * changes are measured from, and how far it takes its work, which a dashboard shows and offers to
 * change, and what it was started for, which a git host's check reads to find the run a thread has.
 */
export function forReaders(mark: Pick<RunnerMark, 'parent' | 'base' | 'baseCommit' | 'publish' | 'for'>): { parent?: string; base?: string; baseCommit?: string; publish?: Publish; for?: string } {
  return {
    ...(mark.parent !== undefined ? { parent: mark.parent } : {}),
    ...(mark.base !== undefined ? { base: mark.base } : {}),
    ...(mark.baseCommit !== undefined ? { baseCommit: mark.baseCommit } : {}),
    ...(mark.publish !== undefined ? { publish: mark.publish } : {}),
    ...(mark.for !== undefined ? { for: mark.for } : {}),
  }
}

/** What the reclaim of a run's checkout is told: the commit its branch was made at, when its mark names one. */
export function startOf(card: RunCard): { from?: string } {
  const from = runnerMark(card)?.baseCommit
  return from !== undefined ? { from } : {}
}

/** Put the run's card on the branch before its agent exists. The outcome says whether it reached origin. */
export function writeMarker(repo: string, card: RunCard, deps: LogsDeps = {}): Promise<FileBranchWrite> {
  return writeRun(repo, card, [], deps)
}

/** Take a marker back: a scheduler lost a cap to another machine's marker, so this run never starts. */
export function withdrawMarker(repo: string, id: string, deps: LogsDeps = {}): Promise<FileBranchWrite> {
  return deleteRun(repo, id, deps)
}

/** Record how a run went: its card and its diary, over the marker. */
export function recordRun(repo: string, card: RunCard, diary: readonly AnyDiaryLine[], deps: LogsDeps = {}): Promise<FileBranchWrite> {
  return writeRun(repo, card, diary, deps)
}

/**
 * Record a run again without its branch when the reclaim deleted that branch: one that held
 * nothing goes with its checkout, and the record must not name a branch that is gone. Written
 * after the reclaim rather than reclaiming first, so the record never says `running` with no
 * checkout behind it. Nothing is written when the branch stayed.
 */
export async function recordBranchGone(repo: string, card: RunCard, diary: readonly AnyDiaryLine[], deleted: readonly string[] | undefined, deps: LogsDeps = {}): Promise<FileBranchWrite | undefined> {
  if (card.branch === undefined || !deleted?.includes(card.branch)) return undefined
  const branchless: RunCard = { ...card }
  delete branchless.branch
  return recordRun(repo, branchless, diary, deps)
}

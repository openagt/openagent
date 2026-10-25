import { runPackageCommand, type ProvidedCommand } from '@openagt/agent-data'
import { providedCommand } from '../built-in.js'

/**
 * Finished runs, as OpenAgent reads them (#1774). OpenAgent keeps no run and imports no
 * records package: a project's finished runs come from whichever of its packages declares that it
 * provides them — `"openagent": { "runs": "<command>" }` in the package's own package.json — and
 * OpenAgent reads them by running that command. Swap the package for another that answers
 * the same command line and prints the same shapes, and nothing here changes. No package declares
 * it: the project has no finished runs, only the ones still running in a checkout.
 *
 * The command line a provider answers, each printing one JSON document and exiting 0:
 *   `<command> --local --full --limit N`   the runs, newest first, whole cards, each with the `person` it is kept under
 *   `<command> show <id> --local --full`   one run: the whole card plus `diary`, every line
 *   `<command> delete <id>`                remove a run
 *   `<command> patch <id> [--branch <b>] [--pr <n> --pr-url <url>] [--landed <commit> --from <commit>]`   the late facts
 * `--local` reads the copy on this machine, no network: OpenAgent polls.
 *
 * The shapes, owned here: {@link RunCard} and {@link AnyDiaryLine}. A running agent's own card in
 * its checkout is the same shape, written by the tool that runs it.
 */

/** How a run stands: still going, or how it ended. */
export type RunStatus = 'running' | 'done' | 'stopped' | 'failed' | 'waiting'

/**
 * A run's card: what was asked, where the work went, how it ended, what it cost. `caller` is the
 * bookkeeping of the program that ran the agent (its pid, host, session id, …), one key.
 */
export interface RunCard {
  id: string
  startedAt: string
  endedAt?: string
  status: RunStatus
  intent?: string
  /** The run's short name, two to five words, as a list of runs shows it; absent when nothing named it. */
  title?: string
  driver?: string
  model?: string
  /** How hard that model was told to think, by the agent's own names (`medium`, `high`, …). */
  effort?: string
  branch?: string
  pr?: { number: number; url: string }
  ticket?: string
  cost?: number
  /** How much of the model's context the conversation filled at the run's last turn. */
  contextTokens?: number
  caller?: Record<string, unknown>
  /** Whom the run is kept under, by their email: said by a provider's list, never written on a card. */
  person?: string
}

/** The two late facts a finished run's card may still learn: the branch its work landed on, its pull request. */
export type RunPatch = Partial<Pick<RunCard, 'branch' | 'pr'>> & {
  /** The run's work was merged and its branch deleted: its last commit, and the commit its work began at. */
  landed?: { commit: string; from: string }
}

/** One line of a run's diary: a JSON object with a `kind`. */
export type AnyDiaryLine = { kind: string } & Record<string, unknown>

/** A finished run: its card and its whole diary. */
export interface FinishedRun {
  card: RunCard
  diary: AnyDiaryLine[]
}

/** A project's finished runs: what a provider answers, read by OpenAgent. */
export interface RunsSource {
  /**
   * Every finished run's card, newest first; `[]` when none can be read. `fresh` skips a list read
   * a moment ago: the caller knows the runs changed since.
   */
  list(opts?: { fresh?: boolean }): Promise<RunCard[]>
  /** One run with its diary; `undefined` for no such run, or none readable. */
  show(id: string): Promise<FinishedRun | undefined>
  /** Remove a run, or why it could not be. */
  remove(id: string): Promise<RunsWrite>
  /** Set a run's late facts, or why they could not be. */
  patch(id: string, patch: RunPatch): Promise<RunsWrite>
}

/** What a change to the runs did: done, or the provider's reason it was not. */
export type RunsWrite = { ok: true } | { ok: false; error: string }

/** The finished runs of the project at `root`, or `undefined` when none of its packages provides them. */
export type RunsFor = (root: string) => Promise<RunsSource | undefined>

/** A {@link RunsFor} that also forgets what it read of one project, for when a module just wrote there. */
export type RunsReader = RunsFor & { changed(root: string): void }

const STATUSES: readonly RunStatus[] = ['running', 'done', 'stopped', 'failed', 'waiting']

/** Whether a string can name a run: letters, digits, `-` and `_`, nothing a path can climb out with. */
export function isRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/**
 * A card read back: the fields of the shape, each kept only when it has the right type, plus
 * `caller` as it is. `undefined` for anything that is not a card — not an object, or missing an
 * id, a start or a status. Takes a card's JSON text or an already-parsed value.
 */
export function parseRunCard(input: unknown): RunCard | undefined {
  let raw = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      return undefined
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const status = r['status']
  if (typeof r['id'] !== 'string' || !isRunId(r['id']) || typeof r['startedAt'] !== 'string' || !(STATUSES as readonly unknown[]).includes(status)) return undefined
  const card: RunCard = { id: r['id'], startedAt: r['startedAt'], status: status as RunStatus }
  for (const key of ['endedAt', 'intent', 'title', 'driver', 'model', 'effort', 'branch', 'ticket', 'person'] as const) {
    if (typeof r[key] === 'string') card[key] = r[key]
  }
  if (typeof r['cost'] === 'number') card.cost = r['cost']
  if (typeof r['contextTokens'] === 'number') card.contextTokens = r['contextTokens']
  const pr = r['pr'] as Record<string, unknown> | undefined
  if (pr && typeof pr === 'object' && typeof pr['number'] === 'number' && typeof pr['url'] === 'string') card.pr = { number: pr['number'], url: pr['url'] }
  const caller = r['caller']
  if (caller && typeof caller === 'object' && !Array.isArray(caller)) card.caller = caller as Record<string, unknown>
  return card
}

/** Diary lines read back from a provider's output: the JSON objects with a string `kind`, in order. */
function diaryLines(value: unknown): AnyDiaryLine[] {
  if (!Array.isArray(value)) return []
  return value.filter((line): line is AnyDiaryLine => !!line && typeof line === 'object' && !Array.isArray(line) && typeof (line as Record<string, unknown>)['kind'] === 'string')
}

/**
 * How many runs a list asks for: every run the project has, in practice. The command line takes a
 * cap, and OpenAgent's lists (the sidebar's history, a ticket's holder, the activity feed) have
 * always read the whole record.
 */
const LIST_LIMIT = 10_000

/** How long a read is reused: the dashboard polls many reads of the same list every few seconds, and each is a process. */
const CACHE_MS = 5_000

/** The runs source over one provider command: each call one run of the command, reads cached per {@link CACHE_MS}. */
function commandRuns(root: string, command: ProvidedCommand, now: () => number): RunsSource & { drop(): void } {
  let listed: { at: number; cards: Promise<RunCard[]> } | undefined
  const shown = new Map<string, { at: number; run: Promise<FinishedRun | undefined> }>()
  const drop = (): void => {
    listed = undefined
    shown.clear()
  }
  return {
    drop,
    list(opts = {}) {
      // Concurrent reads share one process; a read that failed is not kept.
      if (listed && !opts.fresh && now() - listed.at < CACHE_MS) return listed.cards
      const read: { at: number; cards: Promise<RunCard[]> } = { at: now(), cards: Promise.resolve([]) }
      read.cards = runPackageCommand(root, command, ['--local', '--full', '--limit', String(LIST_LIMIT)]).then(result => {
        if (!result.ok || !Array.isArray(result.output)) {
          if (listed === read) listed = undefined
          return []
        }
        return result.output.map(parseRunCard).filter((card): card is RunCard => card !== undefined)
      })
      listed = read
      return read.cards
    },
    show(id) {
      if (!isRunId(id)) return Promise.resolve(undefined)
      const known = shown.get(id)
      if (known && now() - known.at < CACHE_MS) return known.run
      const read: { at: number; run: Promise<FinishedRun | undefined> } = { at: now(), run: Promise.resolve(undefined) }
      read.run = runPackageCommand(root, command, ['show', id, '--local', '--full']).then(result => {
        const output = result.ok ? result.output : undefined
        const card = parseRunCard(output)
        if (!card) {
          if (shown.get(id) === read) shown.delete(id)
          return undefined
        }
        return { card, diary: diaryLines((output as Record<string, unknown>)['diary']) }
      })
      shown.set(id, read)
      return read.run
    },
    async remove(id) {
      if (!isRunId(id)) return { ok: false, error: `not a run id: ${id}` }
      const result = await runPackageCommand(root, command, ['delete', id])
      drop()
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    },
    async patch(id, patch) {
      if (!isRunId(id)) return { ok: false, error: `not a run id: ${id}` }
      const args = ['patch', id, ...(patch.branch !== undefined ? ['--branch', patch.branch] : []), ...(patch.pr ? ['--pr', String(patch.pr.number), '--pr-url', patch.pr.url] : []), ...(patch.landed ? ['--landed', patch.landed.commit, '--from', patch.landed.from] : [])]
      const result = await runPackageCommand(root, command, args)
      drop()
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    },
  }
}

/**
 * The production {@link RunsFor}: the project's provider, looked up among the packages the project has (`built-in.ts`), one
 * source per project kept while the same command provides — so the cache holds across the many
 * reads of one poll, and a project that installs, swaps or drops its provider is read the new way
 * within {@link CACHE_MS}. `changed(root)` forgets that project's reads, so the next read runs the
 * command again: a module's command just ran there, and may have written.
 */
export function providedRuns(now: () => number = Date.now): RunsReader {
  const sources = new Map<string, { at: number; command?: ProvidedCommand; source?: ReturnType<typeof commandRuns> }>()
  const reader: RunsFor = async root => {
    let known = sources.get(root)
    if (!known || now() - known.at >= CACHE_MS) {
      const command = await providedCommand(root, 'runs').catch(() => undefined)
      const same = known?.command && command && known.command.bin === command.bin
      known = { at: now(), ...(command ? { command, source: same ? known!.source! : commandRuns(root, command, now) } : {}) }
      sources.set(root, known)
    }
    return known.source
  }
  return Object.assign(reader, { changed: (root: string) => sources.get(root)?.source?.drop() })
}

/** OpenAgent's one reader of finished runs, shared by every caller so they share its cache. */
export const projectRuns: RunsReader = providedRuns()

/** A {@link RunsFor} for a project with no provider: no finished runs. */
export const noRuns: RunsFor = async () => undefined

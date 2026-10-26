// A run: one agent's work on the project, from its start to its end, recorded as two files on the
// branch — the card, `<id>.json`, and the diary, `<id>.jsonl`. This module is the pure half: what
// the two files hold, and how they are read back. Nothing here touches git or a disk.

/** How a run stands: still going, or how it ended. */
export type RunStatus = 'running' | 'done' | 'stopped' | 'failed' | 'waiting'

/**
 * The card: what was asked, where the work went, how it ended, what it cost. The package's
 * fields, every one plain; `caller` is the writer's own bookkeeping, one key, stored and never read
 * here.
 *
 * A writer may put fields of its own beside these, as it may on a diary line: they pass through a
 * read and a write untouched, and nothing here reads them. They have to, because a card is read
 * and written again by whatever version of this package happens to be running — a run's own
 * process, a resume, a tool landing a subagent's work — and those versions differ. A read that
 * kept only the fields it knew would have each of them quietly strip what the others wrote.
 */
export interface RunCard {
  /** The run's name, file-safe; the writer's ids sort by time, so the id order is the time order. */
  id: string
  /** ISO timestamp. */
  startedAt: string
  /** ISO timestamp, absent while the run is going. */
  endedAt?: string
  status: RunStatus
  /** What the agent was asked to do. */
  intent?: string
  /** The run's short name, two to five words, as a list of runs shows it. */
  title?: string
  /** The agent program that ran: `claude-code`, `codex`, … as the writer names it. */
  driver?: string
  model?: string
  /** How hard that model was told to think, by the agent's own names (`medium`, `high`, …). */
  effort?: string
  /** The branch the work is on. */
  branch?: string
  /** The pull request the work is on. */
  pr?: { number: number; url: string }
  /** What the run cost, in US dollars. */
  cost?: number
  /** How much of the model's context the conversation filled at the run's last turn. */
  contextTokens?: number
  /** The writer's own record, under one key: stored as given, never read. */
  caller?: Record<string, unknown>
}

/** A card as a list of runs says it: with the person it is kept under, by their email, the folder its files are in. */
export type ListedRun = RunCard & { person: string }

/** The two late facts a writer patches onto a card once the run's process is gone. */
export type RunPatch = Partial<Pick<RunCard, 'branch' | 'pr'>> & {
  /**
   * The run's work was merged and its branch deleted: `commit` is the branch's last commit and
   * `from` the commit its work began at. The card loses its branch and keeps the two commits under
   * the writer's key, as `landed` and `baseCommit` (one already there stays), which is where the
   * writer's own tools keep them.
   */
  landed?: { commit: string; from: string }
}

/**
 * A diary line the package knows. A writer may put more fields on any of them, and any other
 * kind of line beside them; both pass through untouched and are ignored here. One such field is
 * common: `at`, when the line was written (ISO 8601).
 */
export type DiaryLine =
  /** Something the agent said. */
  | { kind: 'said'; text: string }
  /** The agent's final answer for a turn. */
  | { kind: 'result'; text: string }
  /** How the run ended, and why when it did not end well. */
  | { kind: 'ended'; status: Exclude<RunStatus, 'running'>; detail?: string }
  /** What a stretch of the run cost, in US dollars. */
  | { kind: 'cost'; usd?: number }

/** Any line of a diary: a JSON object with a `kind`, the package's or the writer's. */
export type AnyDiaryLine = { kind: string } & Record<string, unknown>

const STATUSES: readonly RunStatus[] = ['running', 'done', 'stopped', 'failed', 'waiting']

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

/**
 * Whether a string can name a run: letters, digits, `-` and `_` only. An id is a file name on
 * the branch and a path segment in every read, so this is the one thing that must hold: nothing
 * an id can climb out of a directory with.
 */
export function isRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/** The card's file name under a person's directory. */
export function runCardFile(id: string): string {
  return `${id}.json`
}

/** The diary's file name under a person's directory. */
export function runDiaryFile(id: string): string {
  return `${id}.jsonl`
}

/** The id a card file is named after, or `undefined` for a file that is not one. */
export function runIdOfFile(name: string): string | undefined {
  const id = /^(.+)\.json$/.exec(name)?.[1]
  return id !== undefined && isRunId(id) ? id : undefined
}

/**
 * Longest directory name made from an email. Well past any real address, and short enough that
 * the paths under it stay inside the limits of every platform.
 */
const MAX_PERSON_DIR = 64

/** The directory a person with no usable git identity is filed under. */
export const ANONYMOUS_DIR = 'anonymous'

/**
 * The directory a person's runs are filed under, from the git email their repository commits as:
 * lowercased, with anything outside a conservative set replaced by `-`. The result starts with a
 * letter or digit, which rules out `.`, `..` and dotfile names — the value comes from repository
 * configuration and is joined onto a path. Anything that cannot be made to fit is
 * {@link ANONYMOUS_DIR} rather than a guess, so the run is still kept.
 */
export function personDir(email: string | undefined): string {
  const cleaned = (email ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]/g, '-')
  return cleaned.length > 0 && cleaned.length <= MAX_PERSON_DIR && /^[a-z0-9][a-z0-9@._+-]*$/.test(cleaned) ? cleaned : ANONYMOUS_DIR
}

/** The fields this package knows; every other field on a card is the writer's and passes through. */
const OWN_FIELDS: readonly string[] = ['id', 'startedAt', 'endedAt', 'status', 'intent', 'title', 'driver', 'model', 'effort', 'branch', 'pr', 'cost', 'contextTokens', 'caller']

/**
 * A card read back from its file: the package's fields, each kept only when it has the right
 * shape, plus `caller` as it is, plus every other field the writer put there, as it was.
 * `undefined` for anything that is not a card — not JSON, not an object, or missing an id, a
 * start or a status.
 *
 * A field of the package's own that is there in the wrong shape is dropped, and dropped for good:
 * it is the package's to hold, so a bad one is not carried through as a writer's.
 */
export function parseRunCard(json: string): RunCard | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r['id'] !== 'string' || !isRunId(r['id']) || typeof r['startedAt'] !== 'string' || !isStatus(r['status'])) return undefined
  const card: RunCard = { id: r['id'], startedAt: r['startedAt'], status: r['status'] }
  for (const key of ['endedAt', 'intent', 'title', 'driver', 'model', 'effort', 'branch'] as const) {
    if (typeof r[key] === 'string') card[key] = r[key]
  }
  if (typeof r['cost'] === 'number') card.cost = r['cost']
  if (typeof r['contextTokens'] === 'number') card.contextTokens = r['contextTokens']
  const pr = r['pr']
  if (pr && typeof pr === 'object' && typeof (pr as Record<string, unknown>)['number'] === 'number' && typeof (pr as Record<string, unknown>)['url'] === 'string') {
    card.pr = { number: (pr as { number: number }).number, url: (pr as { url: string }).url }
  }
  const caller = r['caller']
  if (caller && typeof caller === 'object' && !Array.isArray(caller)) card.caller = caller as Record<string, unknown>
  for (const [key, value] of Object.entries(r)) if (!OWN_FIELDS.includes(key)) (card as unknown as Record<string, unknown>)[key] = value
  return card
}

/**
 * A card as it is written: the package's fields first, then the writer's own, `caller` last,
 * pretty, one trailing newline.
 */
export function formatRunCard(card: RunCard): string {
  const { id, startedAt, endedAt, status, intent, title, driver, model, effort, branch, pr, cost, contextTokens, caller, ...theirs } = card
  const ordered = { id, startedAt, endedAt, status, intent, title, driver, model, effort, branch, pr, cost, contextTokens, ...theirs, caller }
  return JSON.stringify(ordered, null, 2) + '\n'
}

/**
 * Every line of a diary, in order, each a JSON object with a string `kind`. A line that is not
 * one is skipped; a line that does not parse ends the read — a writer torn mid-line wrote nothing
 * after it that can be trusted — and everything before it is kept.
 */
export function parseDiary(jsonl: string): AnyDiaryLine[] {
  const lines: AnyDiaryLine[] = []
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch {
      break
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as Record<string, unknown>)['kind'] === 'string') lines.push(raw as AnyDiaryLine)
  }
  return lines
}

/** A diary as it is written: one JSON object per line. */
export function formatDiary(lines: readonly AnyDiaryLine[]): string {
  return lines.map(line => JSON.stringify(line) + '\n').join('')
}

/** Whether a line is one of the four kinds the package knows, with the fields that kind needs. */
export function isDiaryLine(line: AnyDiaryLine): line is DiaryLine & AnyDiaryLine {
  switch (line.kind) {
    case 'said':
    case 'result':
      return typeof line['text'] === 'string'
    case 'ended':
      return isStatus(line['status']) && line['status'] !== 'running' && (line['detail'] === undefined || typeof line['detail'] === 'string')
    case 'cost':
      return line['usd'] === undefined || typeof line['usd'] === 'number'
    default:
      return false
  }
}

/** The agent's own lines of a diary: what it said, its results, how it ended, what it cost. Everything else is the writer's. */
export function agentLines(lines: readonly AnyDiaryLine[]): Array<DiaryLine & AnyDiaryLine> {
  return lines.filter(isDiaryLine)
}

/** Newest first: the writer's ids sort by time, so the id order is the time order, reversed. */
export function newestFirst<T extends { id: string }>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/**
 * The card as the command prints it: everything on it but `caller`, the writer's own bookkeeping.
 * A field a writer put beside the package's own is part of the record and is printed with them.
 */
export function publicCard(card: RunCard): Omit<RunCard, 'caller'> {
  const { caller: _caller, ...own } = card
  return own
}

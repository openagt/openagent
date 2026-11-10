import { join } from 'node:path'
import { isSibling, isTicketFile, META_FILE, onScale, ticketLockName, ticketPlanName, ticketStem } from './names.js'
import { lockHolder } from './locks.js'

/**
 * The read side: what a ticket says about itself, and what the plan and the claim beside it add.
 * Reads a directory of tickets through a small filesystem seam, so the same reader serves a
 * checkout on disk and a branch read straight off git.
 */

/** One ticket, as its row: the head of its markdown plus what its siblings add. */
export interface Ticket {
  /** Filename inside `tickets/`, which is also its identity. */
  file: string
  /** The `# ` heading, else the filename made readable. */
  title: string
  /** The `## TLDR` line, else the first prose line. Empty when the ticket has neither. */
  summary: string
  /** The optional `Priority:` key, verbatim as written — the format says `0`-`10` (`10` acts immediately), but nothing here checks it. */
  priority?: string
  /** The optional `Topics:` key (`Topics: [dx, ui]`), as bare tags. */
  topics?: string[]
  /** The optional `Issue:` key, the tracker's issue this ticket tracks, split into the link text and the URL it points at. */
  issue?: TicketLink
  /** The optional `PR:` key: the pull request that closes this ticket once merged, written by the agent that opened it. Same link shape; a value without a link (`PR: #1790`) is kept as the label, with no URL, and the ticket is in review all the same. */
  pr?: PrLink
  /** The optional `Waiting:` key: what the ticket waits on before anyone can work it, as written. Absent when the ticket is not waiting. */
  waiting?: string
  /**
   * ISO 8601. The `<DATE>_<SLUG>.md` filename's date when it has one — the format every ticket is
   * written in — else the file's modification time, for the rare ticket that predates the format;
   * the epoch when even that is unknown (a read off git), so it sorts last rather than failing.
   */
  date: string
  /** Whether a `.plan.md` sits beside it. */
  planned: boolean
  /**
   * Whether someone holds this ticket: a `.lock.md` claim exists. The claim covers the ticket's
   * whole life — planning it or implementing it — so a locked ticket may also be planned.
   */
  locked?: boolean
  /** Who the `.lock.md` names, from its `CLAIMED: <holder>` line. Absent when the lock is missing or unreadable. */
  lockedBy?: string
  /** The `Effort:` its `.plan.md` preamble records (`0`-`10`, 0 trivial, 10 takes months). Absent when unplanned or unrated. */
  effort?: number
  /** The `Uncertainty:` its `.plan.md` preamble records (`0`-`10`, 0 an obvious implementation, 10 highly uncertain). Absent when unplanned or unrated. */
  uncertainty?: number
  /** Whether the `.plan.md` preamble says `Outdated: yes`: the ticket changed in a way that makes the plan outdated. Absent otherwise. */
  outdated?: true
}

/** A ticket's `Issue:` or `PR:` link, split into what a reader clicks and where it goes. */
export interface TicketLink {
  /** As written, e.g. `#42` — not re-derived, in case the source ever names a PR differently. */
  label: string
  /** The issue/PR URL the label links to. */
  url: string
}

/** A ticket's `PR:` value: a link, or the bare text written there. */
export interface PrLink {
  label: string
  url?: string
}

/** One ticket with its entire markdown rather than just the head. */
export interface TicketDetail extends Ticket {
  content: string
}

/** How the reader reaches the files: a directory on disk, or a tree on a git ref. */
export interface TicketsFs {
  /** The entries of a directory by name; a missing directory reads as none. */
  list: (dir: string) => Promise<string[]>
  /** One file's content, or `undefined` when it cannot be read. */
  read: (path: string) => Promise<string | undefined>
  /** When the file was last written, ISO 8601, or `undefined` when unknown. */
  modifiedAt?: (path: string) => Promise<string | undefined>
}

/** {@link TicketsFs} over `node:fs/promises`. */
export function nodeTicketsFs(): TicketsFs {
  const fs = () => import('node:fs/promises')
  return {
    list: dir => fs().then(f => f.readdir(dir)).catch((): string[] => []),
    read: path => fs().then(f => f.readFile(path, 'utf8')).catch(() => undefined),
    modifiedAt: path => fs().then(f => f.stat(path)).then(s => s.mtime.toISOString(), () => undefined),
  }
}

/** How much of a ticket is read looking for its heading and TLDR. */
const MAX_TICKET_BYTES = 4_000

/**
 * A filename made readable, for a ticket with no heading. The format is `<DATE>_<SLUG>.md`, but
 * tickets imported from an issue tracker can be `<number>-<escaped title>.md`, so decoding and
 * de-underscoring gets both most of the way there.
 */
function titleFromFile(file: string): string {
  const withoutExt = ticketStem(file)
  try {
    return decodeURIComponent(withoutExt).replace(/_/g, ' ')
  } catch {
    return withoutExt.replace(/_/g, ' ')
  }
}

/** The value a preamble's `Key: value` line gives `key`, in any case, trimmed; `undefined` when no line names it. */
function keyValue(preamble: readonly string[], key: string): string | undefined {
  return preamble
    .find(line => line.toLowerCase().startsWith(`${key}:`))
    ?.slice(key.length + 1)
    .trim()
}

/** The first markdown link in `text`, `[label](url)`, split into the two; `undefined` when there is none. */
function linkIn(text: string): TicketLink | undefined {
  const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(text)
  return link ? { label: link[1]!, url: link[2]! } : undefined
}

/**
 * Read the head of a ticket: the `key: value` block above the title (`Priority:`, `Topics:`,
 * `Issue:`, `PR:`, `Waiting:` — all optional), the `# ` heading, and the `## TLDR`. Deliberately tolerant: a ticket
 * predating the format still lists, with whatever it has.
 */
function describe(md: string): { title?: string; summary: string; priority?: string; topics?: string[]; issue?: TicketLink; pr?: PrLink; waiting?: string } {
  const lines = md.split('\n')
  const headingAt = lines.findIndex(line => line.startsWith('# '))
  const heading = headingAt === -1 ? undefined : lines[headingAt]!.slice(2).trim()
  // The key block is above the title, so stop there rather than reading keys out of the body.
  const preamble = headingAt === -1 ? [] : lines.slice(0, headingAt)
  const priority = keyValue(preamble, 'priority')?.toLowerCase()
  // `Topics: [dx, ui]` — the brackets are cosmetic, so they are stripped rather than required.
  const topics = keyValue(preamble, 'topics')
    ?.replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
  // `Issue: [#42](https://example.com/org/repo/issues/42)` — a bare markdown link to the tracker's issue.
  const issueLine = keyValue(preamble, 'issue')
  const issue = issueLine ? linkIn(issueLine) : undefined
  // `PR: [#1790](https://example.com/org/repo/pull/1790)` — the same link shape: the ticket is in review. A person may
  // write the pull request bare (`PR: #1790`); the ticket is in review all the same, so the text stands as the label.
  const prLine = keyValue(preamble, 'pr')
  const pr = prLine ? (linkIn(prLine) ?? { label: prLine }) : undefined
  // `Waiting: web runs to come back` — free text; an empty value waits on nothing.
  const waiting = keyValue(preamble, 'waiting')
  // The TLDR is the ticket in one line, which is exactly what a list row wants.
  const tldrAt = lines.findIndex(line => line.trim().toLowerCase() === '## tldr')
  const body = tldrAt === -1 ? lines.slice(headingAt + 1) : lines.slice(tldrAt + 1)
  const summary = body.find(line => line.trim() !== '' && !line.startsWith('#') && !line.startsWith('Source:'))?.trim() ?? ''
  return {
    ...(heading ? { title: heading } : {}),
    ...(priority ? { priority } : {}),
    ...(topics && topics.length > 0 ? { topics } : {}),
    ...(issue ? { issue } : {}),
    ...(pr ? { pr } : {}),
    ...(waiting ? { waiting } : {}),
    summary,
  }
}

/** `<DATE>_<SLUG>.md`'s `<DATE>`, at midnight UTC. */
const FILENAME_DATE = /^(\d{4}-\d{2}-\d{2})_/

/**
 * A ticket's date: its filename's when it carries one — the one true "when" for a ticket, unlike a
 * modification time, which moves every time the file is merely edited — else the file's
 * modification time, else the epoch.
 */
async function ticketDate(dir: string, file: string, fs: TicketsFs): Promise<string> {
  const match = FILENAME_DATE.exec(file)
  if (match) return `${match[1]}T00:00:00.000Z`
  return (await fs.modifiedAt?.(join(dir, file))) ?? new Date(0).toISOString()
}

/**
 * What a `.plan.md`'s preamble records: `Effort:`, `Uncertainty:` and `Outdated:`, the keys above
 * the `# [Plan]` heading. A rating that is not on the 0-10 scale is no rating.
 */
function planMeta(md: string | undefined): { effort?: number; uncertainty?: number; outdated?: true } {
  if (md === undefined) return {}
  const lines = md.slice(0, MAX_TICKET_BYTES).split('\n')
  const headingAt = lines.findIndex(line => line.startsWith('# '))
  const preamble = headingAt === -1 ? lines : lines.slice(0, headingAt)
  const effort = onScale(keyValue(preamble, 'effort'))
  const uncertainty = onScale(keyValue(preamble, 'uncertainty'))
  const outdated = keyValue(preamble, 'outdated')?.toLowerCase() === 'yes'
  return { ...(effort === undefined ? {} : { effort }), ...(uncertainty === undefined ? {} : { uncertainty }), ...(outdated ? { outdated: true } : {}) }
}

/**
 * One ticket's row: what the head of its markdown says about itself, plus what the `.plan.md`
 * and `.lock.md` beside it add. The lock's existence is the claim; the holder is display sugar,
 * so an unreadable or malformed lock still locks.
 */
async function ticketRow(dir: string, file: string, head: string, siblings: Set<string>, fs: TicketsFs): Promise<Ticket> {
  const { title, summary, priority, topics, issue, pr, waiting } = describe(head)
  const planName = ticketPlanName(file)
  const lockName = ticketLockName(file)
  const [date, plan, lock] = await Promise.all([
    ticketDate(dir, file, fs),
    siblings.has(planName) ? fs.read(join(dir, planName)) : Promise.resolve(undefined),
    siblings.has(lockName) ? fs.read(join(dir, lockName)) : Promise.resolve(undefined),
  ])
  const lockedBy = lock === undefined ? undefined : lockHolder(lock)
  return {
    file,
    title: title ?? titleFromFile(file),
    summary,
    ...(priority ? { priority } : {}),
    ...(topics ? { topics } : {}),
    ...(issue ? { issue } : {}),
    ...(pr ? { pr } : {}),
    ...(waiting ? { waiting } : {}),
    date,
    planned: siblings.has(planName),
    ...(siblings.has(lockName) ? { locked: true } : {}),
    ...(lockedBy !== undefined ? { lockedBy } : {}),
    ...planMeta(plan),
  }
}

/**
 * The tickets in `dir`, newest first. `[]` when there is no such directory. A `.plan.md` or
 * `.lock.md` is written *about* a ticket rather than being one, so it never becomes a row of its
 * own: it marks its ticket instead. Only the head of each ticket is read — nothing below it is
 * shown in a list.
 */
export async function readTickets(dir: string, fs: TicketsFs = nodeTicketsFs()): Promise<Ticket[]> {
  const names = await fs.list(dir)
  const md = names.filter(name => name.endsWith('.md')).sort()
  const siblings = new Set(md.filter(isSibling))
  const tickets: Ticket[] = []
  for (const file of md) {
    if (siblings.has(file)) continue
    const content = await fs.read(join(dir, file))
    if (content === undefined) continue
    tickets.push(await ticketRow(dir, file, content.slice(0, MAX_TICKET_BYTES), siblings, fs))
  }
  tickets.sort((a, b) => b.date.localeCompare(a.date))
  return tickets
}

/**
 * One ticket by filename, full text included. `null` when `file` is not a bare ticket name, is a
 * sibling rather than a ticket, or does not exist.
 */
export async function readTicket(dir: string, file: string, fs: TicketsFs = nodeTicketsFs()): Promise<TicketDetail | null> {
  if (!isTicketFile(file)) return null
  const [content, names] = await Promise.all([fs.read(join(dir, file)), fs.list(dir)])
  if (content === undefined) return null
  return { ...(await ticketRow(dir, file, content, new Set(names), fs)), content }
}

/** Whether `dir` holds any ticket at all — a listing, not a parse, for a caller asking often. */
export async function hasTickets(dir: string, fs: TicketsFs = nodeTicketsFs()): Promise<boolean> {
  return (await fs.list(dir)).some(name => name.endsWith('.md') && !isSibling(name))
}

/** What `tickets/meta.json` records: when the tickets last caught up with the issue tracker. */
export interface TicketsMeta {
  /** ISO 8601 UTC, the moment the last import began. Absent when nothing has recorded one. */
  lastImportedAt?: string
}

/** Big enough for a stamp and whatever is agreed later; small enough that a junk file cannot be read whole. */
const MAX_META_BYTES = 10_000

/**
 * The last-import stamp, or `{}` when there is none to read. Every failure — no file, not JSON,
 * not an object, a stamp that is not a usable date — lands on the same answer: "not known" is
 * true and harmless; failing over a malformed optional file is not.
 */
export async function readTicketsMeta(dir: string, fs: TicketsFs = nodeTicketsFs()): Promise<TicketsMeta> {
  const raw = await fs.read(join(dir, META_FILE))
  if (raw === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(0, MAX_META_BYTES))
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const stamp = (parsed as Record<string, unknown>)['lastImportedAt']
  if (typeof stamp !== 'string' || Number.isNaN(Date.parse(stamp))) return {}
  return { lastImportedAt: stamp }
}

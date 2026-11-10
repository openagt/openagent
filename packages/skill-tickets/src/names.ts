/**
 * The names everything in the package hangs off, and the small pure rules that link a ticket to
 * the agent queue (the `queue` skill's file, which this package never reads or writes) and to the
 * issue it tracks. No node imports, so browser-side code can name them too.
 *
 * Where the tickets are is not named here: `@openagt/agent-data` knows the project's data directory (in
 * the person's own folder, or the project's `agent-data` branch when shared).
 */

/**
 * The directory of the project's data that holds the tickets — `tickets/<DATE>_<SLUG>.md`, their `.plan.md`
 * and `.lock.md` siblings, and `meta.json` — and the name of the repository-root link into it.
 * It holds only open tickets: closing one deletes it.
 */
export const TICKETS_DIR = 'tickets'

/** The file inside `tickets/` that records when the tickets last caught up with an issue tracker. */
export const META_FILE = 'meta.json'

/** A ticket's siblings, written about it and never tickets of their own. */
const SIBLING = /\.(plan|lock)\.md$/

/** A ticket filename without its `.md`. */
export function ticketStem(file: string): string {
  return file.replace(/\.md$/, '')
}

/** A ticket filename's plan sibling: `a.md` → `a.plan.md`. */
export function ticketPlanName(file: string): string {
  return `${ticketStem(file)}.plan.md`
}

/** The ticket a plan sibling is the plan of, {@link ticketPlanName} read backwards: `a.plan.md` → `a.md`; `undefined` for a name that is no plan's. */
export function ticketOfPlan(file: string): string | undefined {
  return file.endsWith('.plan.md') ? `${file.slice(0, -'.plan.md'.length)}.md` : undefined
}

/** A ticket filename's lock sibling: `a.md` → `a.lock.md`. */
export function ticketLockName(file: string): string {
  return `${ticketStem(file)}.lock.md`
}

/**
 * A bare ticket filename: a `.md` name with no path segments (so it cannot address another
 * directory), not starting with a dot, and not one of a ticket's own siblings. The gate every
 * filename that arrives from outside — a command's argument, a browser — goes through.
 */
export function isTicketFile(file: string): boolean {
  return /^[^./\\][^/\\]*\.md$/.test(file) && !SIBLING.test(file)
}

/** Whether a filename inside `tickets/` is a sibling (`.plan.md` / `.lock.md`) rather than a ticket. */
export function isSibling(file: string): boolean {
  return SIBLING.test(file)
}

/** The name a `tickets/<name>` path gives inside `tickets/`; `undefined` for a path that is not under it. */
export function nameInTickets(path: string): string | undefined {
  return path.startsWith(`${TICKETS_DIR}/`) ? path.slice(TICKETS_DIR.length + 1) : undefined
}

/**
 * Whether a string names a ticket by path: `tickets/` followed by a name `isTicketFile` accepts, and
 * nothing else — so the two spellings of a name are refused alike. The one gate for both ends of a
 * queue link: what an entry is read as, and what a caller may record.
 */
export function isTicketPath(path: string): boolean {
  const name = nameInTickets(path)
  return name !== undefined && isTicketFile(name)
}

/**
 * The ticket a queue entry came from, as its `tickets/<file>` path, or `undefined` for an entry
 * that is just text. Queueing a ticket writes the entry as a markdown link back to it, so the
 * identity is on the line; only a link into `tickets/` counts, and only one that stays inside it.
 */
export function ticketFromQueueEntry(entry: string): string | undefined {
  const target = /\]\(([^)\s]+)\)/.exec(entry)?.[1]
  return target && isTicketPath(target) ? target : undefined
}

/**
 * A value on the format's `0`-`10` scale — a ticket's `Priority:`, its plan's `Effort:` and
 * `Uncertainty:` — or `undefined` for anything else. A word, an out-of-range or a fractional value
 * is not clamped into something plausible: it is not a value on this scale, and inventing one
 * hides the typo.
 */
export function onScale(written: string | undefined): number | undefined {
  const value = written?.trim()
  if (value === undefined || !/^\d+$/.test(value)) return undefined
  return Number(value) <= 10 ? Number(value) : undefined
}

/**
 * Which `## Priority N` section of the queue a ticket's own `Priority:` earns it. The ticket
 * format's scale is the queue's (0–10), taken at its word; an unmarked ticket, or one whose value
 * is not {@link onScale}, lands in the middle (5) rather than being guessed at. The scale's ends
 * stay reserved: 10 is for critical production bugs and 0 is an only-if-capacity decision,
 * neither of which a translation should claim.
 */
export function queuePriorityForTicket(priority?: string): number {
  return onScale(priority) ?? 5
}

/**
 * The issue a ticket tracks, as a `#42` reference, or `undefined` when it tracks none. Read off
 * the ticket's `Issue: [#42](…/issues/42)` header line: the number comes from the URL when there
 * is one — the label is display text, the URL is the identity — with the label's own `#42` as the
 * fallback for a hand-written line.
 */
export function ticketIssueRef(md: string): string | undefined {
  const line = md.split('\n').find(l => l.trim().toLowerCase().startsWith('issue:'))
  if (!line) return undefined
  const url = /\((?:[^)]*\/)?(?:issues|pull)\/(\d+)\)/.exec(line)
  const match = url ?? /#(\d+)/.exec(line)
  return match ? `#${match[1]}` : undefined
}

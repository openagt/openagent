import { runPackageCommand, type ProvidedCommand } from '@openagt/agent-data'
import { providedCommand } from '../built-in.js'

/**
 * The tickets, as OpenAgent reads them (#1774). OpenAgent keeps no ticket and imports no
 * tickets package: a project's tickets come from whichever of its packages declares that it
 * provides them — `"openagent": { "tickets": "<command>" }` in the package's own package.json —
 * and OpenAgent reads them by running that command. Swap the package for another that answers
 * the same command line and prints the same shape, and nothing here changes. No package declares
 * it: the project has no tickets, and the dashboard shows it none.
 *
 * The command line a provider answers, printing one JSON document and exiting 0:
 *   `<command> list --local`   every open ticket, as an array of {@link Ticket}
 * `--local` reads the copy on this machine, no network: OpenAgent polls.
 *
 * That is the whole contract. OpenAgent reads tickets for what it composes across skills: the
 * onboarding step, a queued link's title. Showing them, planning them, claiming and releasing them,
 * and the Overview's hot-tickets card, are the tickets package's own module, through its own command.
 *
 * The shape, owned here: {@link Ticket}, the row a ticket lists as.
 */

/** A ticket's row, as a provider prints it. Everything but the five plain facts is optional. */
export interface Ticket {
  /** The ticket's file name, its identity: `tickets/<file>` is the path a link to it carries. */
  file: string
  title: string
  /** One line of what it is about; empty when the ticket says nothing beyond its title. */
  summary: string
  /** `0`–`10` as written, `10` acting at once; absent when unset, and not checked here. */
  priority?: string
  topics?: string[]
  /** The issue it tracks in the project's tracker, and the pull request that closes it: a label and where it points. */
  issue?: { label: string; url: string }
  pr?: { label: string; url: string }
  /** ISO 8601: the file's date. */
  date: string
  /** Whether a plan sits beside it. */
  planned: boolean
  /** Whether someone holds it, and who: a run's id, or a branch. */
  locked?: boolean
  lockedBy?: string
  effort?: number
  uncertainty?: number
}

/** A project's tickets: what a provider answers, read by OpenAgent. */
export interface TicketsSource {
  /** Every open ticket; `[]` when none can be read. */
  list(): Promise<Ticket[]>
}

/** The tickets of the project at `root`, or `undefined` when none of its packages provides them. */
export type TicketsFor = (root: string) => Promise<TicketsSource | undefined>

/** A {@link TicketsFor} that also forgets what it read of one project, for when a module just wrote there. */
export type TicketsReader = TicketsFor & { changed(root: string, pkg?: string): void }

/** How long a read is reused: the dashboard polls several reads of every project's tickets every few seconds, and each is a process. */
const CACHE_MS = 5_000

/** The rows read back from a provider's output: the objects with the five plain facts, everything else as printed; anything else is no ticket. */
export function parseTickets(output: unknown): Ticket[] {
  if (!Array.isArray(output)) return []
  return output.filter(isTicket)
}

function isTicket(value: unknown): value is Ticket {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.file === 'string' && row.file !== '' && typeof row.title === 'string' && typeof row.summary === 'string' && typeof row.date === 'string' && typeof row.planned === 'boolean'
}

/** The tickets source over one provider command: each list one run of the command, reads cached per {@link CACHE_MS}. */
function commandTickets(root: string, command: ProvidedCommand, now: () => number): TicketsSource & { drop(): void } {
  let listed: { at: number; tickets: Promise<Ticket[]> } | undefined
  return {
    drop() {
      listed = undefined
    },
    list() {
      // Concurrent reads share one process; a read that failed is not kept.
      if (listed && now() - listed.at < CACHE_MS) return listed.tickets
      const read: { at: number; tickets: Promise<Ticket[]> } = { at: now(), tickets: Promise.resolve([]) }
      read.tickets = runPackageCommand(root, command, ['list', '--local']).then(result => {
        if (!result.ok || !Array.isArray(result.output)) {
          if (listed === read) listed = undefined
          return []
        }
        return parseTickets(result.output)
      })
      listed = read
      return read.tickets
    },
  }
}

/**
 * The production {@link TicketsReader}: the project's provider, looked up among the packages the project has (`built-in.ts`), one
 * source per project kept while the same command provides — so the cache holds across the many
 * reads of one poll, and a project that installs, swaps or drops its provider is read the new way
 * within {@link CACHE_MS}. `changed(root)` forgets that project's read, so the next read runs the
 * command again: a module's command just ran there, and may have written. `changed(root, pkg)`
 * forgets it only when that package is the one providing: another package's command did not write it.
 */
export function providedTickets(now: () => number = Date.now): TicketsReader {
  const sources = new Map<string, { at: number; command?: ProvidedCommand; source?: ReturnType<typeof commandTickets> }>()
  const reader: TicketsFor = async root => {
    let known = sources.get(root)
    if (!known || now() - known.at >= CACHE_MS) {
      const command = await providedCommand(root, 'tickets').catch(() => undefined)
      const same = known?.command && command && known.command.bin === command.bin
      known = { at: now(), ...(command ? { command, source: same ? known!.source! : commandTickets(root, command, now) } : {}) }
      sources.set(root, known)
    }
    return known.source
  }
  return Object.assign(reader, {
    changed: (root: string, pkg?: string) => {
      const known = sources.get(root)
      if (pkg === undefined || known?.command?.package === pkg) known?.source?.drop()
    },
  })
}

/** OpenAgent's one reader of the tickets, shared by every caller so they share its cache. */
export const projectTickets: TicketsReader = providedTickets()

/** A {@link TicketsFor} for a project with no provider: no tickets. */
export const noTickets: TicketsFor = async () => undefined

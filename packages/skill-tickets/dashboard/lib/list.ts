import type { ModuleHost } from '@openagt/dashboard/module'
import { readListed } from '../../src/module.js'
import type { Ticket } from '../../src/tickets.js'

/** Each project's `list --local` on its way, by project. */
const reading = new Map<string, Promise<{ tickets: Ticket[] } | { error: string }>>()

/**
 * A project's tickets, as `list --local` prints them. Asked while the same list is on its way (the
 * hot tickets card and the queue card naming its links, as the page opens), the answer is that
 * read's: the project is read once. A list is never reused once answered.
 */
export function listTickets(host: ModuleHost, projectId: string): Promise<{ tickets: Ticket[] } | { error: string }> {
  const out = reading.get(projectId)
  if (out) return out
  const read = host.runCommand(projectId, ['list', '--local']).then(readListed)
  reading.set(projectId, read)
  void read.finally(() => reading.get(projectId) === read && reading.delete(projectId))
  return read
}

/** A project's tickets just changed here: a list on its way was asked before, and is no one's answer from now on. */
export function ticketsChanged(projectId: string): void {
  reading.delete(projectId)
}

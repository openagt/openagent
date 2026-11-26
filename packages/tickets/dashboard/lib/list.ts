import { isUnreachable, rpcClient, type UiHost } from '@openagt/ui/module'
import type { Ticket } from '../../src/tickets.js'

/** Each project's list on its way, by project. */
const reading = new Map<string, Promise<{ tickets: Ticket[] } | { error: string }>>()

/**
 * A project's tickets, as the server part's `list` reads them. Asked while the same list is on its way (the
 * hot tickets card and the queue card naming its links, as the page opens), the answer is that
 * read's: the project is read once. A list is never reused once answered.
 */
export function listTickets(host: UiHost, projectId: string): Promise<{ tickets: Ticket[] } | { error: string }> {
  const out = reading.get(projectId)
  if (out) return out
  const read = rpcClient<typeof import('../../src/server.js')>(host)
    .list(projectId, {})
    .then(
      tickets => ({ tickets }),
      (err: unknown) => {
        // OpenAgent did not answer: the reader keeps what it showed and asks again, rather than say it.
        if (isUnreachable(err)) throw err
        return { error: err instanceof Error ? err.message : String(err) }
      },
    )
  reading.set(projectId, read)
  // Once it settles, either way: a read OpenAgent never answered rejects, and its clean-up must not reject again.
  const settled = () => void (reading.get(projectId) === read && reading.delete(projectId))
  read.then(settled, settled)
  return read
}

/** A project's tickets just changed here: a list on its way was asked before, and is no one's answer from now on. */
export function ticketsChanged(projectId: string): void {
  reading.delete(projectId)
}

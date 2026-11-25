import { commandReader } from '@openagt/store-filesystem'
import { nodeGitRunner } from '@openagt/git-branches'
import { read, type RpcHost } from '@openagt/hooks/rpc'
import { nameInTickets, TICKETS_DIR } from './names.js'
import { readShownTicket, readTickets, readTicketsMeta, type ShownTicket, type Ticket, type TicketsMeta } from './tickets.js'

// The tickets' server part (`@openagt/hooks/rpc`): what their pages and their Overview card read,
// this machine's copy with no fetch, cheap enough to poll, as the command's `--local` reads it. They
// change the tickets through the command, as an agent does.

/** This machine's copy of the project's tickets: the directory its writer keeps in step. */
const local = (host: RpcHost) => commandReader(host.root, true, nodeGitRunner())

/** Every open ticket of the project, as its row: what `list` prints. */
export const list = read(async (host): Promise<Ticket[]> => readTickets(TICKETS_DIR, await local(host)))

/**
 * One ticket, named by its file or its `tickets/<file>` path, with its whole text, its plan and who
 * holds it: what `show` prints. `null` for a ticket the project does not have: deleted since the
 * list was read, or a stale link.
 */
export const show = read(async (host, input: { file: string }): Promise<ShownTicket | null> => {
  if (typeof input.file !== 'string') return null
  return readShownTicket(TICKETS_DIR, nameInTickets(input.file) ?? input.file, await local(host))
})

/** When the tickets last caught up with the issue tracker: what `meta` prints. */
export const meta = read(async (host): Promise<TicketsMeta> => readTicketsMeta(TICKETS_DIR, await local(host)))

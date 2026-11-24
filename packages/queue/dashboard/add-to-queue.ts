import { ListPlus } from 'lucide-react'
import { rpcClient, type UiActionAt, type UiHost } from '@openagt/ui/module'
import { addToQueue, alreadyQueued } from '../src/module.js'

const server = (host: UiHost) => rpcClient<typeof import('../src/server.js')>(host)

/**
 * The module's one link action: "Add to queue" on any link a dashboard page shows, in a project
 * that has this package. Each link becomes one `queue add`, the line a queued link is written as
 * (`[text](href)`, or the plain text when it points nowhere), in its priority's section when the
 * page gave one. The module knows nothing of what the links name: a ticket, a plan, anything.
 */
export const ADD_TO_QUEUE: UiActionAt<'link.menu'> = {
  place: 'link.menu',
  id: 'add-to-queue',
  label: 'Add to queue',
  busyLabel: 'Adding…',
  doneLabel: 'Queued',
  icon: ListPlus,
  run: (host, { projectId, links }) =>
    addToQueue({ entries: async () => (await server(host).entries(projectId, { fresh: true })).map(placed => placed.entry), run: args => host.act(projectId, args) }, links),
  // A link an open entry already points at is queued: the button says so in place of offering it again.
  done: async (host, { projectId }) => {
    const entries = (await server(host).entries(projectId, {})).map(placed => placed.entry)
    return link => alreadyQueued(entries, link)
  },
}

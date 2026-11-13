import { ListPlus } from 'lucide-react'
import type { LinkAction } from '@openagt/dashboard/module'
import { addToQueue, alreadyQueued, isEntryLine, readEntries } from '../src/module.js'

/**
 * The module's one link action: "Add to queue" on any link a dashboard page shows, in a project
 * that has this package. Each link becomes one `queue add`, the line a queued link is written as
 * (`[text](href)`, or the plain text when it points nowhere), in its priority's section when the
 * page gave one. The module knows nothing of what the links name: a ticket, a plan, anything.
 */
export const ADD_TO_QUEUE: LinkAction = {
  label: 'Add to queue',
  busyLabel: 'Adding…',
  doneLabel: 'Queued',
  icon: ListPlus,
  run: (host, projectId, links) => addToQueue(args => host.runCommand(projectId, args), links),
  // A link an open entry already points at is queued: the button says so in place of offering it again.
  done: async (host, projectId) => {
    const read = readEntries(await host.runCommand(projectId, ['--local']), isEntryLine)
    if ('error' in read) throw new Error(read.error)
    return link => alreadyQueued(read.entries, link)
  },
}

// The queue's module for the dashboard: the package's `./dashboard` export. It adds one page,
// Queue, that lists the open entries of every project that has this package, by priority section;
// two Overview cards: a tile saying how many entries wait, and AI Queue, that lists them in full and starts agents on them; and one action
// on the links dashboard pages show, "Add to queue". Its data is the `queue` command's own output,
// run in each project by the dashboard: the module reads exactly what an agent reads with
// `npx @openagt/skill-queue@0.1`, and writes exactly the line an agent writes with `npx @openagt/skill-queue@0.1 add`.
import { ListTodo } from 'lucide-react'
import { defineModule } from '@openagt/dashboard/module'
import { QueuePage } from './QueuePage.js'
import { QueueCard } from './QueueCard.js'
import { QueueTile } from './QueueTile.js'
import { ADD_TO_QUEUE } from './add-to-queue.js'
import './dashboard.css'

export default defineModule({
  pages: [{ segment: 'queue', label: 'Queue', icon: ListTodo, Page: QueuePage }],
  cards: [
    { id: 'queued', label: 'In the queue', order: 3, width: '1/3', minWidth: '1/4', Card: QueueTile },
    { id: 'queue', label: 'AI Queue', order: 10, Card: QueueCard },
  ],
  linkActions: [ADD_TO_QUEUE],
  stylesheet: 'dashboard.css',
})

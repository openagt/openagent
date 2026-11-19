// The queue's module for the dashboard: the package's `./dashboard` export. It adds one page,
// Queue, that lists the open entries of every project that has this package, by priority section;
// two Overview cards: a tile saying how many entries wait, and AI Queue, that lists them in full and starts agents on them; and one action
// on the links dashboard pages show, "Add to queue". It reads the queue through its server part,
// exactly what an agent reads with `npx @openagt/skill-queue@0.1`, and changes it through the
// command in each project, writing exactly the line an agent writes with `npx @openagt/skill-queue@0.1 add`.
import { ListTodo } from 'lucide-react'
import { defineUiModule } from '@openagt/ui/module'
import { QueuePage } from './QueuePage.js'
import { QueueCard } from './QueueCard.js'
import { QueuePart } from './QueuePart.js'
import { ADD_TO_QUEUE } from './add-to-queue.js'

export default defineUiModule({
  name: 'queue',
  hooks: {
    'ui.view': [
      { place: 'app.page', id: 'queue', label: 'Queue', icon: ListTodo, View: QueuePage },
      { place: 'overview.line', id: 'queued', label: 'In the queue', order: 3, View: QueuePart },
      { place: 'overview.card', id: 'queue', label: 'AI Queue', order: 8, width: '2/3', minWidth: '1/2', View: QueueCard },
    ],
    'ui.action': [ADD_TO_QUEUE],
  },
})

// The logs' module for the dashboard: the package's `./dashboard` export. It adds one page, Logs,
// that lists the recorded runs of every project that has this package, and one Overview card,
// Members, of who starts runs there. Its data is the `logs`
// command's own output, run in each project by the dashboard: the module reads exactly what an
// agent reads with `npx @openagt/skill-logs@0.1`.
import { ScrollText } from 'lucide-react'
import { defineModule } from '@openagt/dashboard/module'
import { LogsPage } from './LogsPage.js'
import { MembersCard } from './MembersCard.js'
import './dashboard.css'

export default defineModule({
  pages: [{ segment: 'logs', label: 'Logs', icon: ScrollText, Page: LogsPage }],
  cards: [{ id: 'members', label: 'Members', order: 45, width: '1/3', minWidth: '1/4', Card: MembersCard }],
  stylesheet: 'dashboard.css',
})

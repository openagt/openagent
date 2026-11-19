// The logs' module for the dashboard: the package's `./dashboard` export. It adds one page, Logs,
// that lists the recorded runs of every project that has this package, and one Overview card,
// Members, of who starts runs there. It reads them through the package's server part
// (`../src/server.ts`), in each project, as the `logs` command prints them: the module reads what
// an agent reads with `npx @openagt/skill-logs@0.1`.
import { ScrollText } from 'lucide-react'
import { defineUiModule } from '@openagt/ui/module'
import { LogsPage } from './LogsPage.js'
import { MembersCard } from './MembersCard.js'

export default defineUiModule({
  name: 'logs',
  hooks: {
    'ui.view': [
      { place: 'app.page', id: 'logs', label: 'Logs', icon: ScrollText, View: LogsPage },
      { place: 'overview.card', id: 'members', label: 'Members', order: 45, width: '1/3', minWidth: '1/4', View: MembersCard },
    ],
  },
})

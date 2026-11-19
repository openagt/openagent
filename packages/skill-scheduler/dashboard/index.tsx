// The scheduler's module for the dashboard: the package's `./dashboard` export. It adds the
// Automations page, the Scheduler entry of Settings, the Automations card of the Overview,
// the stop line on the usage bar. Its data is the `scheduler` command's own, run in each
// project by the dashboard: `status` to read; `offset`, `switch`, `pace`, `agents`, `agent`, `model`,
// `publish`, `add`, `edit` and `remove` to save; `show` to open an automation, `try` and `write-line`
// for its shell line, and `now` to start a row at once.
import { CalendarClock } from 'lucide-react'
import { defineUiModule } from '@openagt/ui/module'
import { AutomationsPage } from './AutomationsPage.js'
import { SchedulerCard } from './SchedulerCard.js'
import { SchedulerSettings } from './SchedulerSettings.js'
import { StopLine } from './StopLine.js'

export default defineUiModule({
  name: 'scheduled-agents',
  hooks: {
    'ui.view': [
      { place: 'app.page', id: 'automations', label: 'Automations', icon: CalendarClock, View: AutomationsPage },
      { place: 'overview.card', id: 'scheduler', label: 'Automations', order: 90, View: SchedulerCard },
      { place: 'settings.section', id: 'scheduler', title: 'Scheduler', icon: CalendarClock, order: 20, View: SchedulerSettings },
      { place: 'usage.line', id: 'stop-line', View: StopLine },
    ],
  },
})

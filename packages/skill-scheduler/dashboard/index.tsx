// The scheduler's module for the dashboard: the package's `./dashboard` export. It adds the
// Automations page, the Scheduler entry of Settings, the Automations card of the Overview,
// the stop line on the usage bar, and, for the pages of other packages, which commands start by themselves. Its data is the `scheduler` command's own, run in each
// project by the dashboard: `status` to read; `offset`, `switch`, `pace`, `agents`, `agent`, `model`,
// `publish`, `add`, `edit` and `remove` to save; `show` to open an automation, `try` and `write-line`
// for its shell line, and `now` to start a row at once.
import { CalendarClock } from 'lucide-react'
import { defineUiModule } from '@openagt/ui/module'
import { AutomationsPage } from './AutomationsPage.js'
import { SchedulerCard } from './SchedulerCard.js'
import { SchedulerSettings } from './SchedulerSettings.js'
import { StopLine } from './StopLine.js'
import { cannotRun, heldBy, readSchedulers, schedulerStopped, startsNext } from './schedulers.js'

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
  // What starts by itself, for the pages of other packages: a queue says whether anything takes from it.
  schedule: {
    page: 'automations',
    read: async (host, project) => {
      const [row] = await readSchedulers(host, [project])
      // A status that cannot be read says nothing of what starts: the asking page is told so, not "nothing".
      if (!row || row.error !== undefined) throw new Error(row?.error ?? 'the scheduler did not answer')
      const stopped = schedulerStopped(row)
      return row.commands.map(command => ({ command: command.command, on: command.on && stopped === undefined && cannotRun(command) === undefined && heldBy(command) === undefined, ...(command.on ? { note: stopped ?? startsNext(command) } : {}) }))
    },
  },
})

// The scheduler's module for the dashboard: the package's `./dashboard` export. It adds the
// Automations page, the Scheduler section of the Settings page, the Automations card of the Overview,
// the stop line on the usage bar, and, for the pages of other packages, which commands start by themselves. Its data is the `agent-scheduler` command's own, run in each
// project by the dashboard: `status` to read, `offset`, `switch`, `pace`, `agents` and `publish` to save.
import { CalendarClock } from 'lucide-react'
import { defineModule } from '@openagt/dashboard/module'
import { AutomationsPage } from './AutomationsPage.js'
import { SchedulerCard } from './SchedulerCard.js'
import { SchedulerSettings } from './SchedulerSettings.js'
import { loosestSpendOffset, readSchedulers, saveSpendOffset, schedulerStopped, startsNext } from './schedulers.js'
import './dashboard.css'

export default defineModule({
  pages: [{ segment: 'automations', label: 'Automations', icon: CalendarClock, Page: AutomationsPage }],
  cards: [{ id: 'scheduler', order: 90, Card: SchedulerCard }],
  settings: [{ id: 'scheduler', order: 20, Section: SchedulerSettings }],
  usageLimit: {
    read: async (host, projects) => loosestSpendOffset(await readSchedulers(host, projects)),
    save: saveSpendOffset,
  },
  // What starts by itself, for the pages of other packages: a queue says whether anything takes from it.
  schedule: {
    page: 'automations',
    read: async (host, project) => {
      const [row] = await readSchedulers(host, [project])
      if (!row) return []
      const stopped = schedulerStopped(row)
      return row.commands.map(command => ({ command: command.command, on: command.on && stopped === undefined, ...(command.on ? { note: stopped ?? startsNext(command) } : {}) }))
    },
  },
  stylesheet: 'dashboard.css',
})

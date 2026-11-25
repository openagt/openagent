// The tickets' module for the dashboard: the package's `./dashboard` export. It adds one page,
// Tickets, at `/tickets`: every project's backlog, one ticket's own page, and a ticket's plan; the
// names of its files, for the pages of other packages that show one (a queue entry reads as the
// ticket's title, not as a file path); one Overview card, Hot tickets: what agents hold and what is
// flagged high priority; and "Update tickets", which fixes the onboarding's "Populate the tickets". It
// reads the tickets through its server part, exactly what an agent reads with
// `npx @openagt/tickets@0.1 list`, and changes them through the command in each project, lifting a
// claim with the same `npx @openagt/tickets@0.1 release`. What the page composes with other skills — a run started, a claim's
// holder as a run, a plan's author, the actions other modules offer on a ticket as a link —
// comes from the dashboard's own services, and names no other skill.
import { Ticket } from 'lucide-react'
import { defineUiModule } from '@openagt/ui/module'
import { TicketsModulePage } from './TicketsModulePage.js'
import { HotTicketsCard } from './HotTicketsCard.js'
import { namesOf, POPULATE_ACTION, populatedProject, UPDATE_TICKETS_PROMPT } from '../src/module.js'
import { listTickets } from './lib/list.js'

export default defineUiModule({
  name: 'tickets',
  hooks: {
    'ui.view': [
      {
        place: 'app.page',
        id: 'tickets',
        label: 'Tickets',
        icon: Ticket,
        View: TicketsModulePage,
        // What another page's `tickets/<file>` is called: the ticket's title, by the same list the page shows.
        names: async (host, projectId, paths) => {
          const listed = await listTickets(host, projectId)
          return 'error' in listed ? {} : namesOf(paths, listed.tickets)
        },
      },
      { place: 'overview.card', id: 'hot', label: 'Hot tickets', order: 7, width: '1/3', minWidth: '1/4', View: HotTicketsCard },
    ],
    'ui.action': [
      {
        // "Populate the tickets", the module's first step of this computer's (`../src/attention.ts`):
        // a run on the update prompt in the project the step names, landed on.
        place: 'attention.fix',
        id: POPULATE_ACTION,
        label: 'Update tickets',
        run: async (host, { item }) => {
          const projectId = populatedProject(item)
          if (projectId === undefined) return { ok: false, error: 'No project to update the tickets of.' }
          const started = await host.startRun(projectId, UPDATE_TICKETS_PROMPT)
          return started.ok ? { ok: true } : started
        },
      },
    ],
  },
})

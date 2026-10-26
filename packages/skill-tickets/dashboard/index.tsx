// The tickets' module for the dashboard: the package's `./dashboard` export. It adds one page,
// Tickets, at `/tickets`: every project's backlog, one ticket's own page, and a ticket's plan; the
// names of its files, for the pages of other packages that show one (a queue entry reads as the
// ticket's title, not as a file path); and one Overview card, Hot tickets: what agents hold and what is flagged high priority. Its
// data is the `tickets` command's own output, run in each project by the dashboard: the module
// reads exactly what an agent reads with `npx @openagt/skill-tickets@0.1 list`, and lifts a claim with the same
// `npx @openagt/skill-tickets@0.1 release`. What the page composes with other skills — a run started, a claim's
// holder as a run, a plan's author, the actions other modules offer on a ticket as a link —
// comes from the dashboard's own services, and names no other skill.
import { Ticket } from 'lucide-react'
import { defineModule } from '@openagt/dashboard/module'
import { TicketsModulePage } from './TicketsModulePage.js'
import { HotTicketsCard } from './HotTicketsCard.js'
import { namesOf } from '../src/module.js'
import { listTickets } from './lib/list.js'
import './dashboard.css'

export default defineModule({
  pages: [
    {
      segment: 'tickets',
      label: 'Tickets',
      icon: Ticket,
      Page: TicketsModulePage,
      // What another page's `tickets/<file>` is called: the ticket's title, by the same list the page shows.
      names: async (host, projectId, paths) => {
        const listed = await listTickets(host, projectId)
        return 'error' in listed ? {} : namesOf(paths, listed.tickets)
      },
    },
  ],
  cards: [{ id: 'hot', label: 'Hot tickets', order: 20, Card: HotTicketsCard }],
  stylesheet: 'dashboard.css',
})

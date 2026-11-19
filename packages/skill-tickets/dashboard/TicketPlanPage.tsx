import { Markdown, Slot, useModuleHost } from '@openagt/ui/module'
import { planBody } from '../src/module.js'
import { TicketPageShell, TicketPageNote, TicketPageShape } from './TicketPageShell.js'
import { TicketFacts, TicketHeader } from './TicketHeader.js'
import { openToEdit } from './TicketDetailPage.js'
import { useTicket } from './lib/use-ticket.js'

// One ticket's plan, its second tab: under the head it shares with the ticket's page, the plan set
// as a document, without the lines the head already says (its title, its effort and uncertainty).
// `slug` is the ticket's filename, the same the list row and the URL carry, so the plan is
// addressed by the ticket it belongs to.
export function TicketPlanPage({
  projectId,
  slug,
}: {
  projectId: string
  /** The ticket's filename inside `tickets/`, same as `WorkspaceTicket.file`. */
  slug: string
}) {
  const host = useModuleHost()
  const { read, state, released } = useTicket(projectId, slug)
  const ticket = read && 'ticket' in read ? read.ticket : null
  const onBack = () => host.backToPage('tickets')

  return (
    <TicketPageShell
      onBack={onBack}
      // The ticket, by its title, opens it beside the plan, as its Ticket tab does.
      crumbs={ticket ? [{ label: ticket.title, onOpen: () => host.openPage('tickets', [ticket.file], projectId, { beside: true }) }, { label: 'Plan' }] : []}
      aside={ticket && read && 'ticket' in read ? <TicketFacts projectId={projectId} ticket={ticket} holderStatus={read.holderStatus} sessions={read.sessions} /> : undefined}
    >
      <Slot of={{ state, value: read }} shape={<TicketPageShape />}>
        {read =>
          read && 'error' in read ? (
            <TicketPageNote>
              <span role="alert">Could not read the plan: {read.error}</span>
            </TicketPageNote>
          ) : !ticket || !read ? (
            <TicketPageNote>This ticket does not exist.</TicketPageNote>
          ) : (
            <>
              <TicketHeader projectId={projectId} ticket={ticket} holderStatus={read.holderStatus} tab="plan" onEdit={() => openToEdit(host, projectId, ticket.file)} onReleased={released} />
              <div className="max-w-180">
                {read.plan === null ? (
                  // No `.plan.md` beside the ticket: never written, or removed since.
                  <TicketPageNote>No plan yet.</TicketPageNote>
                ) : (
                  <Markdown text={planBody(read.plan)} look="page" />
                )}
              </div>
            </>
          )
        }
      </Slot>
    </TicketPageShell>
  )
}

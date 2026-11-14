import { Markdown, useModuleHost } from '@openagt/dashboard/module'
import { planBody } from '../src/module.js'
import { TicketPageShell, TicketPageNote } from './TicketPageShell.js'
import { TicketHeader } from './TicketHeader.js'
import { useBackToList } from './lib/back-to-list.js'
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
  const { read, state, reload } = useTicket(projectId, slug)
  const ticket = read && 'ticket' in read ? read.ticket : null
  const onBack = useBackToList(host, [slug, 'plan'])

  return (
    <TicketPageShell onBack={onBack} crumbs={ticket ? [{ label: ticket.title, onOpen: () => host.openPage('tickets', [ticket.file], projectId) }, { label: 'Plan' }] : []}>
      {state === 'unknown' ? (
        <TicketPageNote>Loading…</TicketPageNote>
      ) : read && 'error' in read ? (
        <TicketPageNote>
          <span role="alert">Could not read the plan: {read.error}</span>
        </TicketPageNote>
      ) : !ticket || !read ? (
        <TicketPageNote>This ticket does not exist.</TicketPageNote>
      ) : (
        <>
          <TicketHeader projectId={projectId} ticket={ticket} holderStatus={read.holderStatus} sessions={read.sessions} tab="plan" onChanged={() => void reload()} />
          <div className="mt-6">
            {read.plan === null ? (
              // No `.plan.md` beside the ticket — never written, or removed since: the head's button writes one.
              <TicketPageNote>This ticket has no plan yet. Plan now has an agent write one; its menu queues it instead.</TicketPageNote>
            ) : (
              <Markdown text={planBody(read.plan)} page />
            )}
          </div>
        </>
      )}
    </TicketPageShell>
  )
}

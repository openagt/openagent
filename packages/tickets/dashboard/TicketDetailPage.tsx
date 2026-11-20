import { useState } from 'react'
import { Markdown, Slot, useModuleHost, type ModuleHost } from '@openagt/ui/module'
import { claimState, ticketBody } from '../src/module.js'
import { readTicketFile } from '../src/ticket-file.js'
import { TicketPageShell, TicketPageNote, TicketPageShape } from './TicketPageShell.js'
import { TicketFacts, TicketHeader, ticketSlug } from './TicketHeader.js'
import { TicketEditor } from './TicketEditor.js'
import { useTicket } from './lib/use-ticket.js'

/** The ticket whose page opens on its edit form: Edit ticket was chosen on its plan's tab. */
let editOnOpen: string | null = null

/** Open ticket `file`'s page on its edit form, from its plan's tab, beside it: the form edits the ticket, which that tab shows. */
export function openToEdit(host: ModuleHost, projectId: string, file: string): void {
  editOnOpen = file
  host.openPage('tickets', [file], projectId, { beside: true })
}

// One ticket's own page: its whole text, not just the head the list row reads, under the head it
// shares with its plan's page. `slug` is the same filename the list row and the URL carry, so this
// is a direct read by identity rather than a search through the list.
export function TicketDetailPage({
  projectId,
  slug,
}: {
  projectId: string
  /** The ticket's filename inside `tickets/`, same as `WorkspaceTicket.file`. */
  slug: string
}) {
  const host = useModuleHost()
  const { read, state, reload, released } = useTicket(projectId, slug)
  const ticket = read && 'ticket' in read ? read.ticket : null
  const onBack = () => host.backToPage('tickets')
  // The ticket written by hand in place of its text, until saved or left.
  const [editing, setEditing] = useState(() => {
    if (editOnOpen !== slug) return false
    editOnOpen = null
    return true
  })

  return (
    <TicketPageShell
      onBack={onBack}
      crumbs={ticket ? [{ label: ticketSlug(ticket.file), file: true }] : []}
      aside={ticket && read && 'ticket' in read && !editing ? <TicketFacts projectId={projectId} ticket={ticket} holderStatus={read.holderStatus} sessions={read.sessions} /> : undefined}
    >
      <Slot of={{ state, value: read }} shape={<TicketPageShape />}>
        {read =>
          read && 'error' in read ? (
            <TicketPageNote>
              <span role="alert">Could not read the ticket: {read.error}</span>
            </TicketPageNote>
          ) : !ticket || !read ? (
            // Deleted between the list read and this one, or a stale/hand-typed link.
            <TicketPageNote>This ticket does not exist.</TicketPageNote>
          ) : editing ? (
            <>
              <h1 className="mb-6 text-2xl font-semibold tracking-tight max-md:text-xl">Edit ticket</h1>
              <TicketEditor
                projectId={projectId}
                file={ticket.file}
                initial={readTicketFile(ticket.content)}
                issueLabel={ticket.issue?.label}
                workedBy={ticket.locked && claimState(read.holderStatus) === 'working' ? (ticket.lockedByAgent?.name ?? ticket.lockedBy) : undefined}
                // The form stays until the ticket is read as saved: closed sooner, it shows the last read.
                onSaved={() => void reload().then(() => setEditing(false))}
                onCancel={() => setEditing(false)}
              />
            </>
          ) : (
            <>
              <TicketHeader
                projectId={projectId}
                ticket={ticket}
                holderStatus={read.holderStatus}
                tab="ticket"
                onEdit={() => setEditing(true)}
                onReleased={released}
              />
              <div className="max-w-180">
                <Markdown text={ticketBody(ticket.content)} look="page" />
              </div>
            </>
          )
        }
      </Slot>
    </TicketPageShell>
  )
}

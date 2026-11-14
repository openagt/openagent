import { useState } from 'react'
import { Markdown, Slot, useModuleHost } from '@openagt/dashboard/module'
import { ticketBody } from '../src/module.js'
import { readTicketFile } from '../src/ticket-file.js'
import { TicketPageShell, TicketPageNote, TicketPageShape } from './TicketPageShell.js'
import { TicketHeader } from './TicketHeader.js'
import { TicketEditor } from './TicketEditor.js'
import { useBackToList } from './lib/back-to-list.js'
import { useTicket } from './lib/use-ticket.js'

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
  const { read, state, reload } = useTicket(projectId, slug)
  const ticket = read && 'ticket' in read ? read.ticket : null
  const onBack = useBackToList(host, [slug])
  // The ticket written by hand in place of its text, until saved or left.
  const [editing, setEditing] = useState(false)

  return (
    <TicketPageShell onBack={onBack} crumbs={ticket ? [{ label: ticket.title }] : []}>
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
              <h1 className="mb-6 text-xl font-semibold">Edit ticket</h1>
              <TicketEditor
                projectId={projectId}
                file={ticket.file}
                initial={readTicketFile(ticket.content)}
                issueLabel={ticket.issue?.label}
                onSaved={() => {
                  setEditing(false)
                  void reload()
                }}
                onCancel={() => setEditing(false)}
              />
            </>
          ) : (
            <>
              <TicketHeader
                projectId={projectId}
                ticket={ticket}
                holderStatus={read.holderStatus}
                sessions={read.sessions}
                tab="ticket"
                onEdit={() => setEditing(true)}
                onChanged={() => void reload()}
              />
              <div className="mt-6">
                <Markdown text={ticketBody(ticket.content)} page />
              </div>
            </>
          )
        }
      </Slot>
    </TicketPageShell>
  )
}

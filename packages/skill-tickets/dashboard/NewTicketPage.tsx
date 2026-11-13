import { useModuleHost } from '@openagt/dashboard/module'
import { TicketEditor } from './TicketEditor.js'
import { TicketPageShell } from './TicketPageShell.js'

const BLANK = { priority: '', topics: [], title: '', body: '', kept: [] }

/** A ticket written by hand in one project: once created, its own page. */
export function NewTicketPage({ projectId }: { projectId: string }) {
  const host = useModuleHost()
  const back = () => host.openPage('tickets')
  return (
    <TicketPageShell onBack={back} crumbs={[{ label: 'New ticket' }]}>
      <h1 className="mb-4 text-lg font-semibold">New ticket</h1>
      <TicketEditor projectId={projectId} initial={BLANK} onSaved={file => host.openPage('tickets', [file], projectId)} onCancel={back} />
    </TicketPageShell>
  )
}

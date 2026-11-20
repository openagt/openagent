import { useModuleHost } from '@openagt/ui/module'
import { TicketEditor } from './TicketEditor.js'
import { TicketPageShell } from './TicketPageShell.js'

const BLANK = { priority: '', topics: [], waiting: '', title: '', body: '', kept: [] }

/** A ticket written by hand in one project: once created, its own page, in the form's place in the history, so Back goes where New ticket was pressed. */
export function NewTicketPage({ projectId }: { projectId: string }) {
  const host = useModuleHost()
  const back = () => host.backToPage('tickets')
  return (
    <TicketPageShell onBack={back} crumbs={[{ label: 'New ticket' }]}>
      <h1 className="mb-6 text-xl font-semibold">New ticket</h1>
      <TicketEditor projectId={projectId} initial={BLANK} onSaved={file => host.adjustPage([file])} onCancel={back} />
    </TicketPageShell>
  )
}

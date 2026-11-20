import { LinePart, counted, useModuleHost, type UiCardProps } from '@openagt/ui/module'
import { entryView } from './entry.js'
import { useQueueReads } from './reads.js'

/**
 * The queue's part of the line under the Overview's title: how many entries wait their turn, over how
 * many projects on a hover; it opens the Queue page. An entry done already (a plan already written)
 * waits for nothing. Drawn by the shell only where a project has this package, so an Overview with no
 * queue says nothing of one.
 */
export function QueuePart({ projects }: UiCardProps) {
  const host = useModuleHost()
  const { reads, state, names } = useQueueReads(projects)
  const waiting = reads.map(read => read.entries.filter(entry => !entryView(read.project.id, entry, names).done))
  const queued = waiting.reduce((sum, entries) => sum + entries.length, 0)
  const over = waiting.filter(entries => entries.length > 0).length
  return (
    <LinePart reading={state === 'unknown'} shape="4 queued" note={queued === 0 ? 'Nothing waits its turn' : over > 1 ? `Across ${over} projects` : 'Waits for an agent'} href={host.pageHref('queue')} onClick={() => host.openPage('queue')}>
      {counted(queued, 'queued', 'queued', 'nothing queued')}
    </LinePart>
  )
}

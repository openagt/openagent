import { LinePart, counted, useModuleHost, type ModuleCardProps } from '@openagt/dashboard/module'
import { useQueueReads } from './reads.js'

/**
 * The queue's part of the line under the Overview's title: how many entries wait their turn, over how
 * many projects on a hover; it opens the Queue page. Drawn by the shell only where a project has this
 * package, so an Overview with no queue says nothing of one.
 */
export function QueuePart({ projects }: ModuleCardProps) {
  const host = useModuleHost()
  const { reads, loaded } = useQueueReads(projects)
  const queued = reads.reduce((sum, read) => sum + read.entries.length, 0)
  const over = reads.filter(read => read.entries.length > 0).length
  return (
    <LinePart reading={!loaded} note={queued === 0 ? 'Nothing waits its turn' : over > 1 ? `Across ${over} projects` : 'Waits for an agent'} href={host.pageHref('queue')} onClick={() => host.openPage('queue')}>
      {counted(queued, 'queued', 'queued', 'nothing queued')}
    </LinePart>
  )
}

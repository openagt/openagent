import { StatTile, useModuleHost, type ModuleCardProps } from '@openagt/dashboard/module'
import { useQueueReads } from './reads.js'

/**
 * The Overview's tile for the queue: how many entries wait their turn, over how many projects; it
 * opens the Queue page. Drawn by the shell only where a project has this package, so an Overview
 * with no queue has no such tile.
 */
export function QueueTile({ projects }: ModuleCardProps) {
  const host = useModuleHost()
  const { reads } = useQueueReads(projects)
  const queued = reads.reduce((sum, read) => sum + read.entries.length, 0)
  const over = reads.filter(read => read.entries.length > 0).length
  return (
    <StatTile
      label="In the queue"
      value={queued}
      note={queued === 0 ? 'Nothing waits its turn' : over > 1 ? `Across ${over} projects` : 'Waits for an agent'}
      href={host.pageHref('queue')}
      onClick={() => host.openPage('queue')}
    />
  )
}

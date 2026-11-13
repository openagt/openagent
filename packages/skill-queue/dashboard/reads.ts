import { usePolled, useModuleHost, type ModuleAgent, type ModuleProject } from '@openagt/dashboard/module'
import { isEntryLine, readEntries } from '../src/module.js'

/** One project's open entries as read, or why the command failed, and its agents at work. */
export interface ProjectRead {
  project: ModuleProject
  entries: string[]
  /** The project's agents that are working now: an entry one of them was asked is being worked on. */
  working: ModuleAgent[]
  error?: string
}

const NOTHING_READ: ProjectRead[] = []

/**
 * Every project's open entries, from `queue --local` in each: the very list an agent reads. A local
 * read, no fetch: cheap enough to follow the queue closely. The AI Queue card and the queue's tile
 * read it alike.
 */
export function useQueueReads(projects: ModuleProject[]): { reads: ProjectRead[]; loaded: boolean } {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: reads, loaded } = usePolled<ProjectRead[]>(
    () =>
      Promise.all(
        projects.map(async (project): Promise<ProjectRead> => {
          const [read, agents] = await Promise.all([host.runCommand(project.id, ['--local']).then(result => readEntries(result, isEntryLine)), host.agents(project.id).catch(() => [])])
          const working = agents.filter(agent => agent.status === 'running')
          return 'error' in read ? { project, entries: [], working, error: read.error } : { project, entries: read.entries, working }
        }),
      ),
    NOTHING_READ,
    10_000,
    [key],
    // One read for the tile and the card, kept for the next visit: the page opens with the last count.
    { remember: `skill-queue:queue:${key}`, stored: true },
  )
  return { reads, loaded }
}

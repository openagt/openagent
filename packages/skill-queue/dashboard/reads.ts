import { usePolled, useModuleHost, type ModuleProject } from '@openagt/dashboard/module'
import { isEntryLine, readEntries } from '../src/module.js'

/** One project's open entries as read, or why the command failed. */
export interface ProjectRead {
  project: ModuleProject
  entries: string[]
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
          const read = readEntries(await host.runCommand(project.id, ['--local']), isEntryLine)
          return 'error' in read ? { project, entries: [], error: read.error } : { project, entries: read.entries }
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

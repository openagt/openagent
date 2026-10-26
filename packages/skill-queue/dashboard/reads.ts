import { usePolled, useModuleHost, type ModuleProject } from '@openagt/dashboard/module'

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
          const result = await host.runCommand(project.id, ['--local'])
          if (!result.ok) return { project, entries: [], error: result.error }
          if (!Array.isArray(result.output)) return { project, entries: [], error: 'the queue command did not print a list' }
          return { project, entries: result.output.filter((entry): entry is string => typeof entry === 'string') }
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

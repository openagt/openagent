import { pathsIn, rpcClient, runsAgain, useFileNames, usePolled, useModuleHost, type FileNames, type ModuleAgent, type UiProject, type ReadState } from '@openagt/ui/module'

/** One project's open entries as read, or why they could not be, and its agents at work. */
export interface ProjectRead {
  project: UiProject
  entries: string[]
  /** The project's agents that are working now or waiting on the person: an entry one of them was asked is being worked on. */
  working: ModuleAgent[]
  error?: string
}

const NOTHING_READ: ProjectRead[] = []

/**
 * Every project's open entries, from the server part's `entries` in each: the very list an agent
 * reads. This machine's copy, no fetch: cheap enough to follow the queue closely. The AI Queue card
 * and the queue's tile read it alike, with what the files the entries name are called.
 */
export function useQueueReads(projects: UiProject[]): { reads: ProjectRead[]; state: ReadState; names: FileNames } {
  const host = useModuleHost()
  const server = rpcClient<typeof import('../src/server.js')>(host)
  const key = projects.map(p => p.id).join(',')
  const { value: reads, state } = usePolled<ProjectRead[]>(
    () =>
      Promise.all(
        projects.map(async (project): Promise<ProjectRead> => {
          const [read, agents] = await Promise.all([
            server.entries(project.id, {}).then(
              placed => ({ entries: placed.map(each => each.entry) }),
              (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
            ),
            host.agents(project.id).catch(() => []),
          ])
          const working = agents.filter(agent => agent.status === 'running' || agent.status === 'waiting')
          return 'error' in read ? { project, entries: [], working, error: read.error } : { project, entries: read.entries, working }
        }),
      ),
    NOTHING_READ,
    10_000,
    [key],
    // One read for the tile and the card, kept for the next visit: the page opens with the last count.
    { remember: `queue:queue:${key}`, stored: true },
    runsAgain(undefined),
  )
  const names = useFileNames(
    reads.map(read => ({ projectId: read.project.id, paths: read.entries.flatMap(pathsIn) })),
    `queue:queue-names:${key}`,
  )
  return { reads, state, names }
}

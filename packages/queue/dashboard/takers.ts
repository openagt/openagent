import { rpcClient, usePolled, useModuleHost, type UiProject } from '@openagt/ui/module'
import type { Taker } from '../src/server.js'

/** Who takes from each project's queue by itself, by project id: a project not read yet, or whose read failed, has no entry. */
export type Takers = Record<string, Taker>

const UNKNOWN: Takers = {}

/** Who takes from the queues of `projects` by itself (`../src/server.ts`), read every 10 seconds. */
export function useTakers(projects: readonly UiProject[]): Takers {
  const host = useModuleHost()
  const server = rpcClient<typeof import('../src/server.js')>(host)
  const ids = projects.map(project => project.id).join(',')
  const { value } = usePolled<Takers>(
    async () => {
      const read = await Promise.all(
        projects.map(async (project): Promise<[string, Taker] | undefined> =>
          server.taker(project.id, {}).then(
            taker => [project.id, taker],
            () => undefined,
          ),
        ),
      )
      return Object.fromEntries(read.filter(entry => entry !== undefined))
    },
    UNKNOWN,
    10_000,
    [ids],
    // Back on the page, the last answer stands until the fresh one lands, so its line does not pop in.
    { remember: `queue:takers:${ids}`, stored: true },
  )
  // What was read for other projects is not this page's: only the projects asked about are answered.
  return Object.fromEntries(projects.flatMap(project => (value[project.id] ? [[project.id, value[project.id]!]] : [])))
}

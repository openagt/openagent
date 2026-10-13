import { useContext } from 'react'
import { moduleHost, type ModuleProject, type ModuleScheduledCommand } from '../module/index.js'
import { HostServicesContext, INERT_HOST_SERVICES } from './host-services.js'
import { useMountedModules } from './use-modules.js'
import { usePolled } from './use-async.js'

// What starts by itself in the projects a page shows, for a page that is not the scheduling
// module's own: a queue says whether anything takes from it. The page names no module: it asks
// here, and the first installed module that declares a `schedule` answers through its own command.

/** What starts by itself, as a page reads it. */
export interface Schedule {
  /** The page where a person switches a command on: its segment and its sidebar label. */
  page: { segment: string; label: string }
  /** Each project's commands that can start by themselves, by project id; a project the module is not in, or whose read failed, has none. */
  commands: Record<string, ModuleScheduledCommand[]>
  /** Open the page where a person switches a command on. */
  open(): void
}

const NONE: Record<string, ModuleScheduledCommand[]> = {}

/** The commands that start by themselves in `projects`, read every 10 seconds; `undefined` when no installed module schedules anything, and until the first read. */
export function useSchedule(projects: readonly ModuleProject[]): Schedule | undefined {
  const { schedule, pages } = useMountedModules()
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const asked = schedule ? projects.filter(project => schedule.projects.includes(project.id)) : []
  const { value: commands, loaded } = usePolled<Record<string, ModuleScheduledCommand[]>>(
    async () => {
      if (!schedule) return NONE
      const host = moduleHost({ ...services, package: schedule.package })
      const read = await Promise.all(asked.map(async project => [project.id, await schedule.read(host, project).catch(() => [])] as const))
      return Object.fromEntries(read)
    },
    NONE,
    10_000,
    [schedule?.package, asked.map(p => p.id).join(',')],
  )
  if (!schedule || !loaded) return undefined
  const label = pages.find(page => page.segment === schedule.page)?.label ?? schedule.page
  return { page: { segment: schedule.page, label }, commands, open: () => services.openPage(schedule.page) }
}

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
  /** The page where a person switches a command on: its segment, its sidebar label and its address. Absent when no installed module schedules anything. */
  page?: { segment: string; label: string; href: string }
  /**
   * Each project's commands that can start by themselves, by project id: none for a project no
   * scheduling module is in. A project whose answer is not known, not read yet or a read that
   * failed, has no entry: a page then says nothing of it, since "nothing starts" would be a guess.
   */
  commands: Record<string, ModuleScheduledCommand[]>
  /** Open the page where a person switches a command on. */
  open(): void
}

const UNKNOWN: Record<string, ModuleScheduledCommand[]> = {}

/** The commands that start by themselves in `projects`, read every 10 seconds. */
export function useSchedule(projects: readonly ModuleProject[]): Schedule {
  const { schedule, pages, loaded: mounted } = useMountedModules()
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const ids = projects.map(p => p.id).join(',')
  const { value: commands } = usePolled<Record<string, ModuleScheduledCommand[]>>(
    async () => {
      // Which modules are installed is not known yet: neither is what starts.
      if (!mounted) return UNKNOWN
      const host = schedule ? moduleHost({ ...services, package: schedule.package }) : undefined
      const read = await Promise.all(
        projects.map(async (project): Promise<[string, ModuleScheduledCommand[]] | undefined> => {
          if (!schedule || !host || !schedule.projects.includes(project.id)) return [project.id, []]
          return schedule.read(host, project).then(
            listed => [project.id, listed],
            () => undefined,
          )
        }),
      )
      return Object.fromEntries(read.filter(entry => entry !== undefined))
    },
    UNKNOWN,
    10_000,
    [mounted, schedule?.package, schedule?.projects.join(','), ids],
    'previous',
  )
  // What was read for other projects is not this page's: only the projects asked about are answered.
  const asked = Object.fromEntries(projects.flatMap(project => (commands[project.id] ? [[project.id, commands[project.id]!]] : [])))
  if (!schedule) return { commands: asked, open: () => {} }
  const label = pages.find(page => page.segment === schedule.page)?.label ?? schedule.page
  return { page: { segment: schedule.page, label, href: services.pageHref(schedule.page) }, commands: asked, open: () => services.openPage(schedule.page) }
}

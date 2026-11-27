import type { UiSidebarProjectProps } from '../module/index.js'
import type { ProjectSummary } from '../../src/index.js'
import { cn } from '../lib/utils.js'
import { ModuleSlot } from './ModulePageView.js'
import { useViewsAt } from './Places.js'

/** A project's state as a dot: red when a module says something is wrong there (#1500); not for what one press brings up, a folder behind main. */
export function ProjectDot({ project }: { project: ProjectSummary }) {
  return <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', project.errors?.some(e => !e.fixed) ? 'bg-danger' : 'bg-primary')} />
}

// The project every page shows, at the top of the sidebar (#1513): the select a module draws there
// (`sidebar.project`, the projects module's: the launcher's picker, with every project for its
// first row). Until one is drawn, its place is held, so the rows under it never move.
export function SidebarProject(props: UiSidebarProjectProps) {
  const [view] = useViewsAt('sidebar.project', undefined)
  if (!view) return <div aria-hidden className="md:h-9 max-md:h-11" />
  const View = view.View
  return (
    <ModuleSlot package={view.package} label="project select">
      <View {...props} />
    </ModuleSlot>
  )
}

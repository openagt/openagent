import type { OpenAgentEvent } from '../../src/index.js'
import { AgentActionsMenu } from './AgentActionsMenu.js'
import { PaneToggles, TopBar } from './Panes.js'
import { ShowSidebarButton } from './SidebarToggle.js'
import { SESSIONS_ID } from '../../src/project-address.js'

/** The menu is given no session, so no events: it acts on the project. Stable, so it does not churn on every render. */
const NO_EVENTS: OpenAgentEvent[] = []

/** The ⋮ of actions on the project, on the "New agent session" page's bar and on a session's, before the panes' icons. */
export function ProjectMenu({ projectId, onProjectRemoved }: { projectId: string; onProjectRemoved?: (() => void) | undefined }) {
  return <AgentActionsMenu projectId={projectId} events={NO_EVENTS} onProjectRemoved={onProjectRemoved} />
}

// The bar at the top of the "New agent session" page: the project's ⋮ menu and the icons of the page's
// panes (Panes), at the end of the row. The row is laid out as an agent's top bar is
// (AgentActionBar), so the ⋮ and the icons are in the same place on both pages. The page's question
// names it, over the box (ProjectHome); on a phone, where the list comes first, in this bar, where a
// session's bar has the session's name (`name`). The bar names no project and says nothing of the
// project's checkout.
export function ProjectActions({
  projectId,
  name,
  onProjectRemoved,
}: {
  projectId: string
  /** The page's name, as its own heading in the bar. */
  name?: string | undefined
  onProjectRemoved?: (() => void) | undefined
}) {
  return (
    <TopBar>
      <div className="flex h-11 shrink-0 items-center gap-2 overflow-hidden pr-2 pl-4">
        <ShowSidebarButton />
        {name !== undefined && <h1 className={BAR_NAME}>{name}</h1>}
        <div className="grow shrink-0" />
        {/* No project, no menu of a project's. */}
        <PaneToggles before={projectId !== SESSIONS_ID && <ProjectMenu projectId={projectId} onProjectRemoved={onProjectRemoved} />} />
      </div>
    </TopBar>
  )
}

/** The look of a page's name in its top bar, as a session's name stands in its own. */
export const BAR_NAME = 'min-w-0 truncate text-sm font-medium'

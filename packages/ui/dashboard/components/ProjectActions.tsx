import type { OpenAgentEvent } from '../../src/index.js'
import { AgentActionsMenu } from './AgentActionsMenu.js'
import { PaneToggles, TopBar } from './Panes.js'
import { ShowSidebarButton } from './SidebarToggle.js'
import { SESSIONS_ID } from '../../src/project-address.js'

/** The menu is given no session, so no events: it acts on the project. Stable, so it does not churn on every render. */
const NO_EVENTS: OpenAgentEvent[] = []

/** The ⋮ of actions on the project, on the "New agent session" page's bar and on a session's, before the panes' icons. */
export function ProjectMenu({ projectId }: { projectId: string }) {
  return <AgentActionsMenu projectId={projectId} events={NO_EVENTS} />
}

// The bar at the top of the "New agent session" page: the page's name, where a session's bar has the
// session's name (AgentActionBar), and at the end of the row the project's ⋮ menu and the icons of
// the page's panes (Panes). The row is laid out as an agent's top bar is, so the name, the ⋮ and the
// icons are in the same place on both pages. The bar names no project and says nothing of the
// project's checkout.
export function ProjectActions({ projectId }: { projectId: string }) {
  return (
    <TopBar>
      <div className="flex h-11 shrink-0 items-center gap-2 overflow-hidden pr-2 pl-4">
        <ShowSidebarButton />
        {/* As a session's name stands in its own bar. */}
        <h1 className="min-w-0 truncate text-sm font-medium">New agent session</h1>
        <div className="grow shrink-0" />
        {/* No project, no menu of a project's. */}
        <PaneToggles before={projectId !== SESSIONS_ID && <ProjectMenu projectId={projectId} />} />
      </div>
    </TopBar>
  )
}

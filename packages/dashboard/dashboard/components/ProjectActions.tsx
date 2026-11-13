import type { OpenAgentEvent } from '../../src/index.js'
import { AgentActionsMenu } from './AgentActionsMenu.js'
import { PaneMenu, PaneToggles, TopBar } from './Panes.js'
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
// (AgentActionBar), so the ⋮ and the icons are in the same place on both pages. It names no project
// and says nothing of the project's checkout.
export function ProjectActions({
  projectId,
  onProjectRemoved,
}: {
  projectId: string
  onProjectRemoved?: (() => void) | undefined
}) {
  return (
    // As an agent's top bar does, on a phone the row keeps its start free for the menu's button.
    <TopBar>
      <div className="flex h-11 shrink-0 items-center gap-2 overflow-hidden pr-2 md:pl-4 max-md:pl-11">
        <ShowSidebarButton />
        <PaneMenu />
        <div className="grow shrink-0" />
        {/* No project, no menu of a project's. */}
        {/* The ⋮ and the panes' icons, one kind of button, 4px apart. */}
        <div className="flex shrink-0 items-center gap-1">
          {projectId !== SESSIONS_ID && <ProjectMenu projectId={projectId} onProjectRemoved={onProjectRemoved} />}
          <PaneToggles />
        </div>
      </div>
    </TopBar>
  )
}

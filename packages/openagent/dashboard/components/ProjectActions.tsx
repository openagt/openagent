import type { OpenAgentEvent } from '../../src/index.js'
import { AgentActionsMenu } from './AgentActionsMenu.js'
import { PaneMenu, PaneToggles } from './Panes.js'

/** The menu is given no session, so no events: it acts on the project. Stable, so it does not churn on every render. */
const NO_EVENTS: OpenAgentEvent[] = []

// The bar at the top of the "New agent" page: the ⋮ menu of actions on the project and the icons
// of the page's panes (Panes), at the end of the row. The row is laid out as an agent's top bar is
// (AgentActionBar), so the icons are in the same place on both pages. It names no project and says
// nothing of the project's checkout.
export function ProjectActions({
  projectId,
  onProjectRemoved,
}: {
  projectId: string
  onProjectRemoved?: (() => void) | undefined
}) {
  return (
    // As an agent's top bar does, on a phone the row keeps its start free for the menu's button.
    <div className="flex items-center gap-2 overflow-hidden py-2 pr-2 md:pl-4 max-md:pl-11">
      <PaneMenu />
      <div className="grow shrink-0" />
      <AgentActionsMenu projectId={projectId} events={NO_EVENTS} onProjectRemoved={onProjectRemoved} />
      <PaneToggles />
    </div>
  )
}

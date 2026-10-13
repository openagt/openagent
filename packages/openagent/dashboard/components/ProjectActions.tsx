import type { OpenAgentEvent } from '../../src/index.js'
import { AgentActionsMenu } from './AgentActionsMenu.js'

/** The menu is given no session, so no events: it acts on the project. Stable, so it does not churn on every render. */
const NO_EVENTS: OpenAgentEvent[] = []

// The bar at the top of the "New agent" page: the ⋮ menu of actions on the project, alone, at the
// end of the row. The row is laid out as an agent's top bar is (AgentActionBar), so the menu is in
// the same place on both pages. It names no project and says nothing of the project's checkout.
export function ProjectActions({
  projectId,
  onProjectRemoved,
  onOpenSkills,
}: {
  projectId: string
  onProjectRemoved?: (() => void) | undefined
  /** Open the list of the project's skills: given, the menu offers "Skills…". */
  onOpenSkills?: (() => void) | undefined
}) {
  return (
    // As an agent's top bar does, the row keeps its two ends free on a phone, for the shell's two buttons.
    <div className="flex items-center gap-2 overflow-hidden py-2 md:px-4 max-md:px-11">
      <div className="grow shrink-0" />
      <AgentActionsMenu projectId={projectId} events={NO_EVENTS} onProjectRemoved={onProjectRemoved} onOpenSkills={onOpenSkills} />
    </div>
  )
}

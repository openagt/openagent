import { useModuleHost, usePolled, type UiRunProps } from '@openagt/ui/module'
import { server } from './calls.js'

// What the project's row above a session's message box says while the agent does what its Commit
// press asked (drawn while the run works): "Committing…", where the next step stands once the run
// has ended. Read from the server part, which keeps the ask, so a page opened meanwhile
// says it too.

/** How often a working run is asked about: its commit takes seconds. */
const EVERY_MS = 2_000

/** "Committing…" while the run works on a Commit press's ask; nothing otherwise. */
export function Committing({ projectId, agentId, working }: UiRunProps) {
  const host = useModuleHost()
  const { value: committing } = usePolled<boolean>(working ? () => server(host).committing(projectId, { agentId }) : null, false, EVERY_MS, [projectId, agentId, working])
  return working && committing ? (
    <span role="status" className="text-muted-foreground">
      Committing…
    </span>
  ) : null
}

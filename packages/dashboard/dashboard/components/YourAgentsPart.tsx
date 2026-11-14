import { onAgentsList, type AgentsView } from '../rpc/agents.js'
import { usePolled } from '../lib/use-async.js'
import { AGENTS_PAGE, openAgents } from '../lib/use-route.js'
import { LinePart, counted } from './LinePart.js'

// The Overview's line on the person's agents: how many, by name on a hover, and their page a press
// away. The Agents page's own read, kept under its name, so either shows the other's at once.

/** Read again this seldom: agents change when the person changes them, on their page. */
const EVERY_MS = 60_000

export function YourAgentsPart() {
  const { value } = usePolled<AgentsView | undefined>(onAgentsList, undefined, EVERY_MS, [], { remember: 'agents' })
  return (
    <LinePart reading={value === undefined} note={value?.agents.map(agent => agent.name).join(', ')} href={`/${AGENTS_PAGE}`} onClick={openAgents}>
      {counted(value?.agents.length ?? 0, 'agent', 'agents', 'no agents')}
    </LinePart>
  )
}

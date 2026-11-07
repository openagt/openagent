import { onAgentsList, type AgentsView } from '../rpc/agents.js'
import { usePolled } from '../lib/use-async.js'
import { openAgents } from '../lib/use-route.js'
import { StatTile } from './StatTile.js'

// The Overview's "Your agents" tile: how many agents the person has, by name, and their page a
// press away. The Agents page's own read, kept under its name, so either shows the other's at once.

/** Read again this seldom: agents change when the person changes them, on their page. */
const EVERY_MS = 60_000

export function YourAgentsTile() {
  const { value } = usePolled<AgentsView | undefined>(onAgentsList, undefined, EVERY_MS, [], { remember: 'agents' })
  const agents = value?.agents ?? []
  const names = agents.map(agent => agent.name)
  return <StatTile label="Your agents" value={agents.length} note={value === undefined ? 'Loading…' : names.join(', ')} onClick={openAgents} />
}

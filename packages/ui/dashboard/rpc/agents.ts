import type * as impl from '../../src/dashboard-rpc/agents.js'
import { rpc } from '../lib/rpc.js'

// The types the RPC speaks in, straight from the implementation — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard-rpc/agents.js'
export type { OpenAgentUpdate } from '../../src/dashboard/openagent-update.js'

// What a run's agent says of itself, for every page that shows a run; and OpenAgent's own update.
export const onCodingAgents = rpc<typeof impl.onCodingAgents>('onCodingAgents')
export const onNamesRuns = rpc<typeof impl.onNamesRuns>('onNamesRuns')
export const onOpenAgentUpdate = rpc<typeof impl.onOpenAgentUpdate>('onOpenAgentUpdate')

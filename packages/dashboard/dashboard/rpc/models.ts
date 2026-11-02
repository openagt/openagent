import type * as impl from '../../src/dashboard-rpc/models.js'
import { rpc } from '../lib/rpc.js'

// The types the RPC speaks in, straight from the implementation — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard/models.js'
export type { AgentUpdate, AgentUpdateResult } from '../../src/dashboard/agent-updates.js'

// The typed stub for the `models` RPC, checked against the implementation's own signature.

export const onModels = rpc<typeof impl.onModels>('onModels')
export const onAgentUpdates = rpc<typeof impl.onAgentUpdates>('onAgentUpdates')
export const sendAgentUpdate = rpc<typeof impl.sendAgentUpdate>('sendAgentUpdate')

import type * as impl from '../../src/dashboard-rpc/project-agent-data.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/project-agent-data.js'

export const onProjectAgentData = rpc<typeof impl.onProjectAgentData>('onProjectAgentData')

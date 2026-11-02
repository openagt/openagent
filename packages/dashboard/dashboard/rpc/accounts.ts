import type * as impl from '../../src/dashboard-rpc/accounts.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/accounts.js'

// The accounts runs use, per coding agent, as the run's own places read them: adding and removing is the skill's.
export const onAgentAccounts = rpc<typeof impl.onAgentAccounts>('onAgentAccounts')
export const sendUseAgentAccountFirst = rpc<typeof impl.sendUseAgentAccountFirst>('sendUseAgentAccountFirst')

import type * as impl from '../../src/dashboard-rpc/agents.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/agents.js'

// The agents: a name, skills and accounts each, kept in the personal folder.
export const onAgentsList = rpc<typeof impl.onAgentsList>('onAgentsList')
export const sendSaveAgent = rpc<typeof impl.sendSaveAgent>('sendSaveAgent')
export const sendRemoveAgent = rpc<typeof impl.sendRemoveAgent>('sendRemoveAgent')
export const onAgentLogins = rpc<typeof impl.onAgentLogins>('onAgentLogins')
export const sendCopyAgentLogins = rpc<typeof impl.sendCopyAgentLogins>('sendCopyAgentLogins')

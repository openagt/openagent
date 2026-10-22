import type * as impl from '../../src/dashboard-rpc/accounts.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/accounts.js'

// The accounts runs use, per coding agent: the person's own login and the ones added beside it.
export const onAgentAccounts = rpc<typeof impl.onAgentAccounts>('onAgentAccounts')
export const sendAddAgentAccount = rpc<typeof impl.sendAddAgentAccount>('sendAddAgentAccount')
export const sendRemoveAgentAccount = rpc<typeof impl.sendRemoveAgentAccount>('sendRemoveAgentAccount')
export const sendUseAgentAccountFirst = rpc<typeof impl.sendUseAgentAccountFirst>('sendUseAgentAccountFirst')
export const sendNameOwnAgentAccount = rpc<typeof impl.sendNameOwnAgentAccount>('sendNameOwnAgentAccount')

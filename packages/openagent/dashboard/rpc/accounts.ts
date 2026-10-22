import type * as impl from '../../src/dashboard-rpc/accounts.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/accounts.js'

// The Claude accounts runs use: the person's own login and the ones added beside it.
export const onClaudeAccounts = rpc<typeof impl.onClaudeAccounts>('onClaudeAccounts')
export const sendAddClaudeAccount = rpc<typeof impl.sendAddClaudeAccount>('sendAddClaudeAccount')
export const sendRemoveClaudeAccount = rpc<typeof impl.sendRemoveClaudeAccount>('sendRemoveClaudeAccount')
export const sendUseClaudeAccountFirst = rpc<typeof impl.sendUseClaudeAccountFirst>('sendUseClaudeAccountFirst')
export const sendNameOwnClaudeAccount = rpc<typeof impl.sendNameOwnClaudeAccount>('sendNameOwnClaudeAccount')

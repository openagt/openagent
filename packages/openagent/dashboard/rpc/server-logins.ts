import type * as impl from '../../src/dashboard-rpc/server-logins.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/server-logins.js'

// The servers of the person's that use this computer's logins, and how each of its accounts stands there.
export const onServerLogins = rpc<typeof impl.onServerLogins>('onServerLogins')
export const sendUseLoginsOn = rpc<typeof impl.sendUseLoginsOn>('sendUseLoginsOn')
export const sendAllowLogins = rpc<typeof impl.sendAllowLogins>('sendAllowLogins')
export const sendSettleLogin = rpc<typeof impl.sendSettleLogin>('sendSettleLogin')

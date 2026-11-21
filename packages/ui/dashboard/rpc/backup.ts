import type * as impl from '../../src/dashboard-rpc/backup.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/backup.js'

export const onBackup = rpc<typeof impl.onBackup>('onBackup')
export const sendBackUpAs = rpc<typeof impl.sendBackUpAs>('sendBackUpAs')

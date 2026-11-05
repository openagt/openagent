import type * as impl from '../../src/dashboard-rpc/folders.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/folders.js'

export const onFolders = rpc<typeof impl.onFolders>('onFolders')
export const sendSyncPersonalFolder = rpc<typeof impl.sendSyncPersonalFolder>('sendSyncPersonalFolder')
export const sendStopSyncingPersonalFolder = rpc<typeof impl.sendStopSyncingPersonalFolder>('sendStopSyncingPersonalFolder')

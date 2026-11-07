import type * as impl from '../../src/dashboard-rpc/personal-folder.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/personal-folder.js'

export const onPersonalFolder = rpc<typeof impl.onPersonalFolder>('onPersonalFolder')
export const sendSyncPersonalFolder = rpc<typeof impl.sendSyncPersonalFolder>('sendSyncPersonalFolder')
export const sendStopSyncingPersonalFolder = rpc<typeof impl.sendStopSyncingPersonalFolder>('sendStopSyncingPersonalFolder')
export const sendPersonalFolderAs = rpc<typeof impl.sendPersonalFolderAs>('sendPersonalFolderAs')

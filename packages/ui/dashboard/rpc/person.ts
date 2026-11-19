import type * as impl from '../../src/dashboard-rpc/person.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/person.js'

// The person at this dashboard: the name and picture the foot of the sidebar shows.
export const onPerson = rpc<typeof impl.onPerson>('onPerson')
export const sendSavePersonName = rpc<typeof impl.sendSavePersonName>('sendSavePersonName')
export const sendRemovePersonPicture = rpc<typeof impl.sendRemovePersonPicture>('sendRemovePersonPicture')
export const sendSyncPersonFromGitHub = rpc<typeof impl.sendSyncPersonFromGitHub>('sendSyncPersonFromGitHub')
export const sendForgetPerson = rpc<typeof impl.sendForgetPerson>('sendForgetPerson')

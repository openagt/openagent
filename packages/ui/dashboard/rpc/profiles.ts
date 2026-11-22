import type * as impl from '../../src/dashboard-rpc/profiles.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/profiles.js'

// The profiles: a name and a saved set of run options each, kept with the person.
export const onProfilesList = rpc<typeof impl.onProfilesList>('onProfilesList')
export const sendSaveProfile = rpc<typeof impl.sendSaveProfile>('sendSaveProfile')
export const sendRemoveProfile = rpc<typeof impl.sendRemoveProfile>('sendRemoveProfile')

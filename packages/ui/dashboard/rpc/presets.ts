import type * as impl from '../../src/dashboard-rpc/presets.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/presets.js'

// The presets: a name and a saved set of run options each, kept with the person.
export const onPresetsList = rpc<typeof impl.onPresetsList>('onPresetsList')
export const sendSavePreset = rpc<typeof impl.sendSavePreset>('sendSavePreset')
export const sendRemovePreset = rpc<typeof impl.sendRemovePreset>('sendRemovePreset')
export const onPresetLogins = rpc<typeof impl.onPresetLogins>('onPresetLogins')
export const sendCopyPresetLogins = rpc<typeof impl.sendCopyPresetLogins>('sendCopyPresetLogins')

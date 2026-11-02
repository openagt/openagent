import type * as impl from '../../src/dashboard-rpc/preferences.js'
import { rpc } from '../lib/rpc.js'

// The types the RPCs speak in, straight from the implementations — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard-rpc/preferences.js'
/** What `onEditors` answers with; it is defined where the detection lives, not with the RPC. */
export type { EditorInfo } from '../../src/dashboard/open-in-app.js'

// Typed stubs for the `preferences` RPCs (F3). Each is checked against the implementation's own
// signature, so a rename or a changed argument is a type error here rather than a 404 at runtime.
// These used to be re-export shims whose only job was pinning Telefunc's baked RPC keys to this
// file's path; the transport addresses calls by name now, so the path carries no meaning.

export const onPreferences = rpc<typeof impl.onPreferences>('onPreferences')
export const savePreferences = rpc<typeof impl.savePreferences>('savePreferences')
export const patchPreferences = rpc<typeof impl.patchPreferences>('patchPreferences')
export const onProjectPresets = rpc<typeof impl.onProjectPresets>('onProjectPresets')
export const saveProjectPresets = rpc<typeof impl.saveProjectPresets>('saveProjectPresets')
export const onEditors = rpc<typeof impl.onEditors>('onEditors')

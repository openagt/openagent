import type * as impl from '../../src/dashboard-rpc/projects.js'
import { rpc } from '../lib/rpc.js'

// The types the RPCs speak in, straight from the implementations — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard-rpc/projects.js'

// Typed stubs for the `projects` RPCs (F3). Each is checked against the implementation's own
// signature, so a rename or a changed argument is a type error here rather than a 404 at runtime.
// These used to be re-export shims whose only job was pinning Telefunc's baked RPC keys to this
// file's path; the transport addresses calls by name now, so the path carries no meaning.

export const onProjects = rpc<typeof impl.onProjects>('onProjects')
export const sendAddProject = rpc<typeof impl.sendAddProject>('sendAddProject')
export const onCloneTarget = rpc<typeof impl.onCloneTarget>('onCloneTarget')
export const sendAddProjectFromAddress = rpc<typeof impl.sendAddProjectFromAddress>('sendAddProjectFromAddress')
export const sendRemoveProject = rpc<typeof impl.sendRemoveProject>('sendRemoveProject')
export const onRecordsReach = rpc<typeof impl.onRecordsReach>('onRecordsReach')
export const sendShareRecords = rpc<typeof impl.sendShareRecords>('sendShareRecords')
export const sendPickProjectDirectory = rpc<typeof impl.sendPickProjectDirectory>('sendPickProjectDirectory')
export const onOnboarding = rpc<typeof impl.onOnboarding>('onOnboarding')
export const onCommands = rpc<typeof impl.onCommands>('onCommands')
export const onStartCheck = rpc<typeof impl.onStartCheck>('onStartCheck')

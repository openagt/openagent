import type * as impl from '../../src/dashboard-rpc/reads.js'
import { rpc } from '../lib/rpc.js'

// The types the RPCs speak in, straight from the implementations — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard-rpc/reads.js'

// Typed stubs for the `reads` RPCs (F3). Each is checked against the implementation's own
// signature, so a rename or a changed argument is a type error here rather than a 404 at runtime.
// These used to be re-export shims whose only job was pinning Telefunc's baked RPC keys to this
// file's path; the transport addresses calls by name now, so the path carries no meaning.

export const onAgents = rpc<typeof impl.onAgents>('onAgents')
export const onModuleAgents = rpc<typeof impl.onModuleAgents>('onModuleAgents')
export const onRunCheckout = rpc<typeof impl.onRunCheckout>('onRunCheckout')
export const onAgent = rpc<typeof impl.onAgent>('onAgent')
export const onAgentsDoing = rpc<typeof impl.onAgentsDoing>('onAgentsDoing')
export const onDocs = rpc<typeof impl.onDocs>('onDocs')
export const onOverview = rpc<typeof impl.onOverview>('onOverview')
export const onRecentAgents = rpc<typeof impl.onRecentAgents>('onRecentAgents')
export const onAllAgents = rpc<typeof impl.onAllAgents>('onAllAgents')
export const onWaiting = rpc<typeof impl.onWaiting>('onWaiting')
export const onActivity = rpc<typeof impl.onActivity>('onActivity')
export const onDashboard = rpc<typeof impl.onDashboard>('onDashboard')
export const onProjectFiles = rpc<typeof impl.onProjectFiles>('onProjectFiles')

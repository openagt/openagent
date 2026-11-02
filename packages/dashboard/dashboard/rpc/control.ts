import type * as impl from '../../src/dashboard-rpc/control.js'
import { rpc } from '../lib/rpc.js'

// The types the RPCs speak in, straight from the implementations — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard-rpc/control.js'

// Typed stubs for the `control` RPCs (F3). Each is checked against the implementation's own
// signature, so a rename or a changed argument is a type error here rather than a 404 at runtime.
// These used to be re-export shims whose only job was pinning Telefunc's baked RPC keys to this
// file's path; the transport addresses calls by name now, so the path carries no meaning.

export const sendStop = rpc<typeof impl.sendStop>('sendStop')
export const sendChoice = rpc<typeof impl.sendChoice>('sendChoice')
export const sendBridgeAnswer = rpc<typeof impl.sendBridgeAnswer>('sendBridgeAnswer')
export const sendBridgeAnswerCancel = rpc<typeof impl.sendBridgeAnswerCancel>('sendBridgeAnswerCancel')
export const sendBridgeBrowser = rpc<typeof impl.sendBridgeBrowser>('sendBridgeBrowser')
export const sendMessage = rpc<typeof impl.sendMessage>('sendMessage')
export const sendRemoveWorktree = rpc<typeof impl.sendRemoveWorktree>('sendRemoveWorktree')
export const sendDeleteAgent = rpc<typeof impl.sendDeleteAgent>('sendDeleteAgent')
export const sendStart = rpc<typeof impl.sendStart>('sendStart')
export const sendOpenInApp = rpc<typeof impl.sendOpenInApp>('sendOpenInApp')
export const sendOpenPullRequest = rpc<typeof impl.sendOpenPullRequest>('sendOpenPullRequest')
export const sendMerge = rpc<typeof impl.sendMerge>('sendMerge')
export const sendPush = rpc<typeof impl.sendPush>('sendPush')
export const sendMergeBranch = rpc<typeof impl.sendMergeBranch>('sendMergeBranch')
export const sendCreateRepository = rpc<typeof impl.sendCreateRepository>('sendCreateRepository')

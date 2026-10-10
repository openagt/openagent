import { onProjectFiles, onGitStatus, onAgentWorktree, onAgentHandoff, onAgent } from './reads.js'
import { readModule } from './modules.js'
import { sendStop, sendChoice, sendMessage, sendOpenPullRequest, sendPush, sendMerge } from './control.js'

// The machine side of the remote-agent relay (#1067 slice 2). A daemon that relayed an agent here asks this
// to read/steer/hand off THAT run against THIS machine's own checkout. Every entry is a run-scoped RPC
// the dashboard already exposes to its own browser. The only change: arg[0] (the remote daemon's
// project id, meaningless here) is replaced with this machine's own id for the project the call
// named by its repository's address (relay-endpoints.ts). These functions
// resolve their path through the same registry the browser's own calls do.
// They run with no browser request behind them, which is sound because
// the one thing they read off the context here — is this agent relayed onward? — defaults to no,
// and on the machine that is the truth: the agent is local here, so forwarding it again would loop.
// Whitelist only: start/delete/remove-worktree stay OFF it.

type RelayFn = (...args: unknown[]) => Promise<unknown>
// Null-prototype, like RPC_HANDLERS (R1): the key is a request-controlled string, so a plain object
// would answer `constructor`/`toString`/`valueOf` off Object.prototype and invoke them as handlers.
const RELAY_FNS = Object.assign(Object.create(null) as Record<string, RelayFn>, {
  onProjectFiles, readModule,
  onGitStatus, onAgentWorktree, onAgentHandoff, onAgent,
  sendStop, sendChoice, sendMessage, sendOpenPullRequest, sendPush, sendMerge,
}) as unknown as Record<string, RelayFn>

/** The names a relay caller may invoke. */
export const RELAY_RPC_NAMES: readonly string[] = Object.keys(RELAY_FNS)

/**
 * Dispatch one relayed RPC against `projectId` (this machine's own id for the project). `args[0]`
 * from the caller is the remote daemon's project id and is meaningless here, so it is replaced
 * with `projectId`; the rest (path, agentId, ...) carry through unchanged. Throws on an unknown name.
 */
export async function dispatchRelayRpc(projectId: string, fn: string, args: unknown[]): Promise<unknown> {
  const impl = RELAY_FNS[fn]
  if (!impl) throw new Error(`unknown relay rpc: ${fn}`)
  return impl(projectId, ...args.slice(1))
}

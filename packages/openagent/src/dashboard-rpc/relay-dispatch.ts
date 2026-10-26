import { onProjectFiles, onGitStatus, onAgentWorktree, onAgentHandoff, onAgent, onOwnRuns } from './reads.js'
import { readModule } from './modules.js'
import { sendStop, sendChoice, sendMessage, sendOpenPullRequest, sendPush, sendMerge } from './control.js'
import { asArrived } from './relay-agent.js'
import { onStartCheck } from './projects.js'
import { onCopiedLogins, sendCopiedLogin, sendCopiedUsage, sendForgetCopiedLogin, sendKeepCopiedLogin } from './copied-logins.js'
import { patchPreferences } from './preferences.js'

// The machine side of the remote-agent relay (#1067 slice 2). A daemon that relayed an agent here asks this
// to read/steer/hand off THAT run against THIS machine's own checkout. Every entry is a run-scoped RPC
// the dashboard already exposes to its own browser. The only change: arg[0] (the remote daemon's
// project id, meaningless here) is replaced with this machine's own id for the project the call
// named by its repository's address (relay-endpoints.ts). These functions
// resolve their path through the same registry the browser's own calls do.
// They run as calls that arrived from another computer (`asArrived`): the agent is local here,
// whatever its record says, so nothing is forwarded again and no call goes round.
// Whitelist only: start/delete/remove-worktree stay OFF it.

type RelayFn = (...args: unknown[]) => Promise<unknown>
// Each entry is a read or an act, and this is the one place that says which: a computer that only
// lets its server watch answers the reads and refuses the acts (relay-endpoints.ts). An entry goes
// in one of the two lists, so nothing is relayed that was not classed. `readModule` is a read for
// as long as a module's read changes nothing, which is what a module's read is.
const RELAY_READS = { onProjectFiles, readModule, onGitStatus, onAgentWorktree, onAgentHandoff, onAgent, onOwnRuns, onStartCheck }
const RELAY_ACTS = { sendStop, sendChoice, sendMessage, sendOpenPullRequest, sendPush, sendMerge }
// Null-prototype, like RPC_HANDLERS (R1): the key is a request-controlled string, so a plain object
// would answer `constructor`/`toString`/`valueOf` off Object.prototype and invoke them as handlers.
const RELAY_FNS = Object.assign(Object.create(null) as Record<string, RelayFn>, RELAY_READS, RELAY_ACTS) as unknown as Record<string, RelayFn>

/** The names a relay caller may invoke. */
export const RELAY_RPC_NAMES: readonly string[] = Object.keys(RELAY_FNS)

/** Whether a relayed RPC only reads. A name that is not on the whitelist is no read. */
export function isRelayRead(fn: string): boolean {
  return Object.hasOwn(RELAY_READS, fn)
}

/**
 * Dispatch one relayed RPC against `projectId` (this machine's own id for the project). `args[0]`
 * from the caller is the remote daemon's project id and is meaningless here, so it is replaced
 * with `projectId`; the rest (path, agentId, ...) carry through unchanged. Throws on an unknown name.
 */
export async function dispatchRelayRpc(projectId: string, fn: string, args: unknown[]): Promise<unknown> {
  const impl = RELAY_FNS[fn]
  if (!impl) throw new Error(`unknown relay rpc: ${fn}`)
  return asArrived(() => impl(projectId, ...args.slice(1)))
}

// The machine-wide calls: what the person's own computer asks of a server about the whole of it,
// not a run (logins-sync.ts brings the server's logins and settings up to its own). They go by the
// relay too, so a computer that keeps a line open to its server is asked them as any server is:
// a line carries nothing but the relay. Classed the same way, read or act.
const MACHINE_READS = { onCopiedLogins }
const MACHINE_ACTS = { sendCopiedLogin, sendForgetCopiedLogin, sendKeepCopiedLogin, sendCopiedUsage, patchPreferences }
const MACHINE_FNS = Object.assign(Object.create(null) as Record<string, RelayFn>, MACHINE_READS, MACHINE_ACTS) as unknown as Record<string, RelayFn>

/** The machine-wide names a relay caller may invoke. */
export const MACHINE_RPC_NAMES: readonly string[] = Object.keys(MACHINE_FNS)

/** Whether a machine-wide call only reads. A name that is not on the whitelist is no read. */
export function isMachineRead(fn: string): boolean {
  return Object.hasOwn(MACHINE_READS, fn)
}

/** Dispatch one machine-wide call, its arguments as the caller gave them. Throws on an unknown name. */
export async function dispatchMachineRpc(fn: string, args: unknown[]): Promise<unknown> {
  const impl = MACHINE_FNS[fn]
  if (!impl) throw new Error(`unknown machine rpc: ${fn}`)
  return impl(...args)
}

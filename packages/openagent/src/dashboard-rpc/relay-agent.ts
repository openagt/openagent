import { contextRemote } from './context.js'
import { relayRpc } from '../dashboard/remote-run.js'

/**
 * Run a run-scoped RPC locally, or relay it to the machine when `agentId` names an agent this daemon is
 * relaying to a saved one (#1067 slice 2). For an ordinary local agent the remote lookup is empty and
 * `local()` runs unchanged. For a remote agent there is no local checkout, so the call is forwarded to the
 * machine over the token; if the machine is unreachable, `unreachable` is returned - the same empty/error
 * shape `local()` gives on a failed read - so the caller never special-cases a remote agent.
 */
export async function relayOr<T>(
  agentId: string | undefined,
  fn: string,
  args: unknown[],
  local: () => Promise<T>,
  unreachable: T,
): Promise<T> {
  const target = contextRemote()?.target(agentId)
  if (!target) return local()
  try {
    return (await relayRpc(target, fn, args)) as T
  } catch {
    return unreachable
  }
}

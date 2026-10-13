import { AsyncLocalStorage } from 'node:async_hooks'
import { contextRemote } from './context.js'
import { MachineRefusal, relayRpc } from '../dashboard/remote-run.js'

/**
 * Set around a call that came in from another computer: it is run here, whatever a run's record
 * says of where the run is. The computer that sent it decided where it goes, and a call passed
 * on again could go round between two computers that have each other saved.
 */
const arrived = new AsyncLocalStorage<true>()

/** Run `call` as one that came in from another computer: nothing in it is passed on to a machine. */
export function asArrived<T>(call: () => Promise<T>): Promise<T> {
  return arrived.run(true, call)
}

/** A call that only reads: answered from what this computer holds when the machine cannot be asked. */
const isRead = (fn: string): boolean => fn.startsWith('on') || fn === 'readModule'
/** What a read answers of a run it does not know: nothing, or an empty list. */
const isNothing = (said: unknown): boolean => said === null || said === undefined || (Array.isArray(said) && said.length === 0)

/**
 * Run a run-scoped RPC locally, or relay it to the machine when `agentId` names an agent that runs on a
 * saved one (#1067 slice 2): one this daemon sent there, or one the machine's own page started,
 * known here by its record. For an ordinary local agent the remote lookup is empty and
 * `local()` runs unchanged. For a remote agent the call is forwarded to the machine with this
 * computer's key there. If the machine is unreachable, no longer lets this computer in, or
 * knows nothing of the run, a read
 * is answered from what this computer holds of the run, its record when it has one, and
 * anything that would change the run answers `unreachable`: it is never done here in the
 * machine's place. A machine that refused and said why (one that only lets its server watch) is
 * answered in its own words, where `unreachable` has words of its own to replace.
 */
export async function relayOr<T>(
  agentId: string | undefined,
  fn: string,
  args: unknown[],
  local: () => Promise<T>,
  unreachable: T,
): Promise<T> {
  if (arrived.getStore()) return local()
  // Every relayed call names its project first: the machine a run runs on is found by its record there.
  const [projectId] = args
  const target = agentId !== undefined && typeof projectId === 'string' ? await contextRemote().home(projectId, agentId) : undefined
  if (!target) return local()
  const mine = (): Promise<T> => local().catch(() => unreachable)
  try {
    const said = (await relayRpc(target, fn, args)) as T
    // A machine that knows nothing of the run, one whose name another computer shares, answers a read with nothing: this computer's own record of the run may say more.
    if (isRead(fn) && isNothing(said)) {
      const kept = await mine()
      return isNothing(kept) ? said : kept
    }
    return said
  } catch (err) {
    if (isRead(fn)) return mine()
    return err instanceof MachineRefusal && unreachable !== null && typeof unreachable === 'object' && 'error' in unreachable ? { ...unreachable, error: err.message } : unreachable
  }
}

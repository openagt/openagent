import { resolve } from 'node:path'

/**
 * Serialize the dashboard's own actions against one run's checkout.
 *
 * Two clicks on the same finished run (Open PR, and Remove or Delete of its checkout) each run
 * their own git in that checkout. Unserialized they raced: the loser reported "could not commit
 * the work this session left uncommitted", and a removal that lost kept a worktree it should have
 * taken. Both actions are served inside the daemon's own process (the dashboard's RPCs are), so
 * an in-process lock is the whole fix between them.
 *
 * It does NOT coordinate with the run's own tool (#1774), which is another process and reclaims
 * the checkout itself when the run ends. What keeps those two apart is that the run has to have
 * ended before the dashboard offers either action, and that the tool's own reclaim refuses a
 * checkout it cannot take cleanly.
 *
 * Keyed by the checkout path, resolved, so the actions against one run contend on one key;
 * actions against a run whose checkout is already gone key on the project root, where nothing
 * contends. A waiter chains on the predecessor's *settlement* — a failed removal must not skip
 * the action waiting behind it — and each caller still gets its own outcome (or failure) back
 * untouched.
 */
const chains = new Map<string, Promise<unknown>>()

/** Run `fn` once every earlier holder of `checkout`'s lock has settled. */
export async function withAgentLock<T>(checkout: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(checkout)
  const prev = chains.get(key) ?? Promise.resolve()
  const agent = prev.then(fn, fn)
  // What the next waiter chains on: settlement, never rejection — one failed holder must not
  // poison every later acquisition of the same key.
  const settled = agent.then(
    () => {},
    () => {},
  )
  chains.set(key, settled)
  try {
    return await agent
  } finally {
    if (chains.get(key) === settled) chains.delete(key)
  }
}

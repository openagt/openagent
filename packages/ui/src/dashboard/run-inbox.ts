import { hostname } from 'node:os'
import type { InboxLine } from '@openagt/agent-driver'
import { errorMessage } from '@openagt/agent-data'
import { runHostOf } from '../dashboard-rpc/context.js'
import { isArrived } from '../dashboard-rpc/relay-agent.js'
import { runRefAt } from '../distribution-hooks.js'
import { withAgentLock } from '../agent-locks.js'
import { findAgent } from '../store/index.js'

/**
 * What a person says to a run (#1774): their own words, their answer to the question the run
 * stopped on, or what they do about a message still on its way. The daemon runs no agent: the line
 * goes to the run's host (`run.host`, #2394), this computer's unless another host has the run, which
 * hands it to the run while the run works, and resumes the run with it once the run has ended.
 */

/** What a write to a run came to: done, or why not, in words the surface shows. */
export type SteerResult = { ok: true } | { ok: false; error: string }

/**
 * The key every action on one run locks under (`agent-locks.ts`): a Remove, a Delete and an Open
 * PR on the same run each run their own git; serialized, whichever runs second finds the state
 * the first one left and acts on that. The project and the run's id, not the checkout's path:
 * the path is the branches provider's to know, and an Open PR on a run whose checkout is gone
 * still locks the run.
 */
export function agentLockKey(cwd: string, agentId: string): string {
  return `${cwd}\0${agentId}`
}

/**
 * Why a run is not continued from here: one another computer started, which is no saved machine,
 * is only read. Continued here it would move to this computer under its id, with this
 * computer's logins and none of its conversation. A call another computer passed on was sent
 * to the run's own computer already, and is not asked.
 */
export async function startedElsewhere(cwd: string, agentId: string): Promise<SteerResult | undefined> {
  if (isArrived()) return undefined
  const host = (await findAgent(cwd, agentId).catch(() => undefined))?.host
  return host !== undefined && host !== hostname() ? { ok: false, error: `This run is on ${host}. Continue it there.` } : undefined
}

/** Hand one line to the run `agentId` of the project `projectId`, which is at `cwd`. */
export async function sayToRun(projectId: string, cwd: string, agentId: string, line: InboxLine): Promise<SteerResult> {
  try {
    const run = await runRefAt(projectId, cwd, agentId)
    await (await runHostOf(run)).steer(run, line)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/**
 * Say one line to a run as a module's server part says it (`RpcHost.say`): under the run's lock,
 * so it waits for an action on the run under way, and never to a run another computer started.
 * Throws why it was not said.
 */
export async function sayForModule(projectId: string, cwd: string, agentId: string, line: InboxLine): Promise<void> {
  const said = await withAgentLock(agentLockKey(cwd, agentId), async () => (await startedElsewhere(cwd, agentId)) ?? sayToRun(projectId, cwd, agentId, line))
  if (!said.ok) throw new Error(said.error)
}

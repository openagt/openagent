import { hostname } from 'node:os'
import { errorMessage } from '@openagt/agent-data'
import { contextRun, runHostOf } from '../dashboard-rpc/context.js'

import { runRefAt } from '../distribution-hooks.js'
import { withAgentLock } from '../agent-locks.js'
import { LOCAL_HOST, type InboxLine } from '@openagt/hooks'

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
 * the path is the run's host's to know, and an Open PR on a run whose checkout is gone still
 * locks the run.
 */
export function agentLockKey(cwd: string, agentId: string): string {
  return `${cwd}\0${agentId}`
}

/**
 * Why a run is not continued from here: one another computer started, whose record came through
 * the project's shared records, is only read. Continued here it would move to this computer under
 * its id, with this computer's logins and none of its conversation.
 */
export async function startedElsewhere(projectId: string, agentId: string): Promise<SteerResult | undefined> {
  const host = (await contextRun(projectId, agentId).catch(() => undefined))?.host
  return host !== undefined && host !== hostname() ? { ok: false, error: `This run is on ${host}. Continue it there.` } : undefined
}

/** Hand one line to the run `agentId` of the project `projectId`, which is at `cwd`. */
export async function sayToRun(projectId: string, cwd: string, agentId: string, line: InboxLine): Promise<SteerResult> {
  try {
    const run = await runRefAt(projectId, cwd, agentId)
    const host = await runHostOf(run)
    // The images stay on this computer, and go only to a run that does.
    if (line.kind === 'message' && line.images !== undefined && line.images.length > 0 && host.id !== LOCAL_HOST) return { ok: false, error: `Images stay on this computer: this run is on ${host.label}.` }
    await host.steer(run, line)
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
  const said = await withAgentLock(agentLockKey(cwd, agentId), async () => (await startedElsewhere(projectId, agentId)) ?? sayToRun(projectId, cwd, agentId, line))
  if (!said.ok) throw new Error(said.error)
}

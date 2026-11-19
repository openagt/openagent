import type { InboxLine } from '@openagt/agent-driver'
import { errorMessage } from '@openagt/agent-data'
import { contextHost } from '../dashboard-rpc/context.js'
import { runRefAt } from '../distribution-hooks.js'

/**
 * What a person says to a run (#1774): their own words, their answer to the question the run
 * stopped on, or what they do about a message still on its way. The daemon runs no agent: the line
 * goes to this computer's host (`run.host`, #2394), which hands it to the run while the run works,
 * and resumes the run with it once the run has ended.
 */

/** What a write to a run came to: done, or why not, in words the surface shows. */
export type SteerResult = { ok: true } | { ok: false; error: string }

/** Hand one line to the run `agentId` of the project `projectId`, which is at `cwd`. */
export async function sayToRun(projectId: string, cwd: string, agentId: string, line: InboxLine): Promise<SteerResult> {
  try {
    await contextHost().steer(await runRefAt(projectId, cwd, agentId), line)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

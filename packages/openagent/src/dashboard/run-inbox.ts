import { hostname } from 'node:os'
import { join } from 'node:path'
import { appendInbox, takeInbox, type InboxLine } from '@openagt/agent-driver'
import { OPENAGENT_DIR } from '../openagent-dir.js'
import { runResumeHook } from '../project-hooks.js'
import { findAgent, isPidAlive, resolveAgentCheckout } from '../store/index.js'

/**
 * What a person says to a run (#1774): their own words, or their answer to the question the run
 * stopped on. The daemon runs no agent, so the line reaches the run through what the run's tool
 * reads: the inbox file in the run's checkout while the run works, the project's `resume` hook
 * line once it has ended. OpenAgent names no tool in either.
 */

/**
 * The inbox of a run, in its checkout's `.openagent/`: the file agent-driver's session reads
 * when a turn ends, one JSON line per message or answer. The run's tool hands the session the
 * same path.
 */
export const RUN_INBOX_FILE = 'inbox.jsonl'

/** What a write to a run came to: done, or why not, in words the surface shows. */
export type SteerResult = { ok: true } | { ok: false; error: string }

/** Whether the run's card says it is working, on this machine, under a process that is alive. */
async function isRunWorking(cwd: string, agentId: string): Promise<boolean> {
  const agent = await findAgent(cwd, agentId).catch(() => undefined)
  return agent?.status === 'running' && agent.pid !== undefined && agent.host === hostname() && isPidAlive(agent.pid)
}

/**
 * Hand one line to a run of the project at `cwd`. A run that is working takes it from its inbox
 * when its turn ends. A run that has ended (done, stopped, failed, or waiting on its question) is
 * continued through the project's `resume` hook. A run that ends while the line is on its way
 * would leave it in an inbox nobody reads, so the run is looked at again after the write, and
 * what is still in the inbox then is taken back and resumes the run instead.
 */
export async function sayToRun(
  cwd: string,
  agentId: string,
  line: InboxLine,
  deps: { isWorking?: (cwd: string, agentId: string) => Promise<boolean> } = {},
): Promise<SteerResult> {
  const isWorking = deps.isWorking ?? isRunWorking
  const lines = [line]
  if (await isWorking(cwd, agentId)) {
    const inbox = join(await resolveAgentCheckout(cwd, agentId), OPENAGENT_DIR, RUN_INBOX_FILE)
    await appendInbox(inbox, line)
    if (await isWorking(cwd, agentId)) return { ok: true }
    lines.splice(0, 1, ...(await takeInbox(inbox)))
  }
  for (const stranded of lines) {
    const resumed = await runResumeHook(cwd, {
      runId: agentId,
      ...(stranded.kind === 'message' ? { text: stranded.text } : { answer: stranded.answer }),
    })
    if (!resumed.ok) return resumed
  }
  return { ok: true }
}

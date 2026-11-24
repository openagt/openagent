import type { RunFeedEvent, RunRef } from '@openagt/hooks'
import { contextProject, runHostOf } from './context.js'

// The live event stream behind the dashboard (#405): the selected run's events, as its host
// streams them (`RunHost.events`). Each one becomes one `send(event)`, which the mount writes out
// as one SSE frame. Runs, docs, and the project log come over the read-model RPCs (reads.ts).

/**
 * Follow one run's events: `send` is called per event until the returned stop function runs.
 * Returns undefined when there is nothing to stream (no run named, an unknown project, a host that
 * streams no events), which the mount ends as a clean close, mirroring the read model's empty
 * results rather than throwing at the client. The host's end-of-replay marker is passed on: what
 * comes after it is live.
 */
export async function streamAgentEvents(projectId: string, agentId: string | undefined, send: (value: RunFeedEvent) => void): Promise<(() => void) | undefined> {
  if (agentId === undefined) return undefined
  const at = await contextProject(projectId)
  if (!at) return undefined
  const run: RunRef = { id: agentId, ...(at.project ? { project: at.project } : {}) }
  const host = await runHostOf(run)
  if (!host.events) return undefined
  const stop = new AbortController()
  const events = host.events(run, stop.signal)
  void (async () => {
    for await (const event of events) send(event)
  })().catch(() => {})
  return () => stop.abort()
}

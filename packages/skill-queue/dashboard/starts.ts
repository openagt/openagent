import { useState } from 'react'
import type { ModuleHost } from '@openagt/dashboard/module'
import { DEFAULT_FAN_OUT_COUNT, fanOut, topEntries, workOnEntryPrompt } from '../src/module.js'

// The two ways to start agents on the queue, shared by the Queue page and the Overview's card, so
// a start is the same act wherever it is pressed. One entry: one agent, on that entry alone, and
// the dashboard lands on the run. A project's batch: one agent per top entry, as many as its count
// says, each pinned to its own entry, and the page stays where it is.

export interface QueueStarts {
  /** Which entry's start is in flight, as `starting(projectId, entry)` tells. */
  starting(projectId: string, entry: string): boolean
  /** Whether this project's batch is in flight. */
  fanningOut(projectId: string): boolean
  /** A start is in flight somewhere: every start button waits for it. */
  inFlight: boolean
  /** Why the last start was refused. */
  error: string | null
  /** The count beside a project's batch button. */
  countOf(projectId: string): number
  setCount(projectId: string, count: number): void
  startEntry(projectId: string, entry: string): Promise<void>
  fanOutProject(projectId: string, entries: readonly string[]): Promise<void>
}

export function useQueueStarts(host: ModuleHost): QueueStarts {
  // Keyed by content rather than index: the list is polled and can shift under a click, and only
  // the clicked row's button should spin.
  const [starting, setStarting] = useState<string | null>(null)
  // A sequence of starts, held as one so a second click cannot slip between two of them.
  const [fanningOut, setFanningOut] = useState<string | null>(null)
  // Per project, since queues differ in depth.
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const inFlight = starting !== null || fanningOut !== null
  const countOf = (projectId: string): number => counts[projectId] ?? DEFAULT_FAN_OUT_COUNT
  return {
    starting: (projectId, entry) => starting === `${projectId}\n${entry}`,
    fanningOut: projectId => fanningOut === projectId,
    inFlight,
    error,
    countOf,
    setCount: (projectId, count) => setCounts(prev => ({ ...prev, [projectId]: Math.max(count, 1) })),
    async startEntry(projectId, entry) {
      if (inFlight) return
      setStarting(`${projectId}\n${entry}`)
      setError(null)
      // One run on one named entry is a session to watch: the dashboard lands on it.
      const result = await host.startRun(projectId, workOnEntryPrompt(entry))
      setStarting(null)
      if (!result.ok) setError(result.error)
    },
    async fanOutProject(projectId, entries) {
      if (inFlight) return
      setFanningOut(projectId)
      setError(null)
      // A batch lands nowhere: the runs show among the agents at work, and the page stays.
      const outcome = await fanOut(prompt => host.startRun(projectId, prompt, { land: false }), topEntries(entries, countOf(projectId)))
      setFanningOut(null)
      if (outcome.error !== undefined) setError(outcome.error)
    },
  }
}

import { useEffect, useState } from 'react'
import { DiffStat, useModuleHost, type ModuleRunProps } from '@openagt/dashboard/module'
import type { FileChange } from '../src/diff.js'
import { readCounts } from './reads.js'

// What a working run has changed so far, on its page (#817): a count in the bar above the message
// box. Which files changed, and their diffs, are in the Changes pane.
//
// Read from the run's own checkout, not from the agent's tool calls: a tool's name reaches the
// dashboard but not its arguments, and git is both the honest source (the outcome, not the intent)
// and the one that works for every coding agent. Read only while the run works: once it has ended,
// the dashboard's handoff says what its branch holds, and until that is read the count stays as the
// run left it (#1030) rather than blanking.

/** How many files the working run has touched, and how many lines, in the bar above the message box (#1023). */
export function ChangesSummary({ projectId, agentId, working }: ModuleRunProps) {
  const host = useModuleHost()
  // The changes last read, with the run they are of: the page swaps runs without a remount, and
  // one run's count must never show as the next one's.
  const run = `${projectId}\0${agentId}`
  const [read, setRead] = useState<{ run: string; changes: FileChange[] } | null>(null)
  const changes = read?.run === run ? read.changes : []
  // Read every 8 seconds while the run works, and never after: a run with no checkout left has
  // nothing to read, and the count it ended with stays until the handoff takes over.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => setTick(t => t + 1), 8_000)
    return () => clearInterval(timer)
  }, [working])
  useEffect(() => {
    if (!working) return
    let live = true
    readCounts(host, projectId, agentId).then(
      next => live && setRead({ run, changes: next }),
      () => {}, // a failed read keeps the last count; the next tick usually succeeds
    )
    return () => void (live = false)
    // `host` is the same services every render; the read is keyed by the run and the tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, agentId, working, tick])

  if (changes.length === 0) return null
  const added = changes.reduce((sum, c) => sum + c.added, 0)
  const removed = changes.reduce((sum, c) => sum + c.removed, 0)
  return (
    <span className="flex items-center gap-x-2 text-muted-foreground">
      <span>
        {changes.length} {changes.length === 1 ? 'file' : 'files'}
      </span>
      <DiffStat added={added} removed={removed} className="text-xs" />
    </span>
  )
}

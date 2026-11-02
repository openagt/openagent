import { useEffect, useRef, useState } from 'react'
import type { AgentHandoff } from '../../src/index.js'
import { onAgentHandoff } from '../rpc/reads.js'
import { forgetRemembered, usePolled } from './use-async.js'
import { useAction } from './use-action.js'

/** What the agent view knows about the session's branch, and how it acts on it. */
export type AgentHandoffState = {
  handoff: AgentHandoff | null
  /** True once the read has answered, so an empty state isn't flashed before then. */
  loaded: boolean
  busy: boolean
  error: string | null
  /** Which button is in flight, so it can say "Opening PR…" rather than silently greying (#948). */
  pending: 'pr' | 'merge' | 'push' | 'merge-branch' | 'commit' | null
  act: (which: 'pr' | 'merge' | 'push' | 'merge-branch' | 'commit', fn: () => Promise<unknown>, fallback: string) => void
}

// The handoff read lifted out of its panel: the same answer feeds two places in the bar above the
// message box, the summary and the actions. Reading it once keeps them from disagreeing and halves
// the polling.
/**
 * How soon to ask again while the daemon's pull request lookup is still out: the answer lands in
 * well under a second, and the bar says nothing about the branch until it has.
 */
export const PR_PENDING_MS = 300

/** How often the branch is read while nothing is moving. */
const REST_MS = 15_000

/**
 * How long after a run's turn ends its branch is read every second rather than every fifteen.
 *
 * A clean run makes its own last commit while it cleans up, after its turn has ended, so the first
 * read taken then answers for a branch that holds nothing yet. Waiting a quarter of a minute for
 * the next read is why the bar's last step used to arrive late, and why the bar itself blinked.
 */
export const SETTLING_MS = 10_000

/** How often the branch is read in that window. */
export const SETTLING_EVERY_MS = 1_000

/**
 * Whether a run's branch gives the bar above the message box something to say: work it holds
 * (commits, changed files, files left uncommitted), work that was landed, or a branch that is gone
 * with work on it. A run that changed nothing has nothing said, and so no bar.
 */
export function handoffSays(handoff: AgentHandoff | null): boolean {
  if (!handoff) return false
  if (handoff.landed) return true
  if (!handoff.exists) return !handoff.unchanged
  return !handoff.empty || handoff.commits.length > 0 || Boolean(handoff.pendingFiles?.length)
}

/**
 * `saving`: the run's clean-up is still going (its card says saving); the branch is read again the
 * moment it is done, since the clean-up may have deleted an empty branch or pushed one.
 * `working`: the run works, so the answer read before it did is no longer what its branch holds.
 */
export function useAgentHandoff(projectId: string, agentId: string | null | undefined, enabled = true, saving = false, working = false): AgentHandoffState {
  // Polled rather than read once: a push or a PR opened from here (or from a terminal) changes
  // what to offer, and `reload` makes the bar's own actions land immediately. Not read while the
  // run is live (#1026): a branch still being written to has nothing to hand off yet.
  // Same as the bar above it (#1028): fifteen seconds at rest, but a PR lookup still in flight
  // holds the Open PR offer back, so that one is worth asking again for straight away.
  // A run that works again writes to its branch: the answer remembered from before is not the
  // one shown when the run ends, which would put the last step back for a moment.
  const key = agentId ? `handoff:${projectId}:${agentId}` : undefined
  useEffect(() => {
    if (working && key !== undefined) forgetRemembered(key)
  }, [working, key])
  // The run's turn has just ended: its branch is read again every second until it has something to
  // say, since the run's own last commit lands moments after its turn does ({@link SETTLING_MS}).
  const [settling, setSettling] = useState(false)
  const wasWorking = useRef(working)
  useEffect(() => {
    if (wasWorking.current && !working) setSettling(true)
    wasWorking.current = working
  }, [working])
  useEffect(() => {
    if (!settling) return
    const timer = setTimeout(() => setSettling(false), SETTLING_MS)
    return () => clearTimeout(timer)
  }, [settling])
  // How often to ask: every second while the branch is still settling, straight away again while
  // the pull request lookup is out, every fifteen seconds at rest. A cadence change reads at once,
  // which is how the read the moment a run ends is taken at all.
  const [everyMs, setEveryMs] = useState(REST_MS)
  const { value: handoff, reload, loaded } = usePolled<AgentHandoff | null>(
    enabled && agentId ? () => onAgentHandoff(projectId, agentId) : null,
    null,
    everyMs,
    [projectId, agentId, enabled, everyMs, saving],
    // Remembered per run: going back to a run shows its last answer at once while it is read
    // again, and a cadence flip (prPending 15s↔1s) keeps the answer rather than blanking the
    // summary for a beat. Another run's answer is never shown.
    key !== undefined ? { remember: key } : undefined,
  )
  useEffect(() => setEveryMs(handoff?.prPending ? PR_PENDING_MS : settling ? SETTLING_EVERY_MS : REST_MS), [handoff?.prPending, settling])
  // Once the branch has something to say, the run's work is on it: back to the resting pace.
  useEffect(() => {
    if (settling && handoffSays(handoff)) setSettling(false)
  }, [settling, handoff])
  const { busy, error, run } = useAction()
  const [pending, setPending] = useState<'pr' | 'merge' | 'push' | 'merge-branch' | 'commit' | null>(null)

  const act = (which: 'pr' | 'merge' | 'push' | 'merge-branch' | 'commit', fn: () => Promise<unknown>, fallback: string): void => {
    setPending(which)
    // The button says what it is doing until the branch is read again: let go before, it read
    // as not pressed for the beat the read takes.
    void run(fn, fallback)
      .then(outcome => (outcome.ok ? reload() : undefined))
      .then(() => setPending(null))
  }

  return { handoff, loaded, busy, error, pending, act }
}

import { useEffect, useRef, useState } from 'react'
import type { AgentHandoff } from '../../src/index.js'
import { onAgentHandoff } from '../rpc/reads.js'
import { forgetRemembered, useAskOn, usePolled, type ReadState } from './use-async.js'

/** What the agent view knows about the session's branch. */
export type AgentHandoffState = {
  handoff: AgentHandoff | null
  /** What is known of the branch: an empty state isn't flashed while it is unknown. */
  state: ReadState
}

// The handoff read lifted out of its panel: whether the bar above the message box has something
// to say for the run's branch, and when it is over.

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
 * Whether a run's turn has just ended, so what it leaves is read every {@link SETTLING_EVERY_MS}:
 * from `working` going false, for {@link SETTLING_MS}, or until `settled` says it has landed.
 */
export function useSettling(working: boolean, settled = false): boolean {
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
  useEffect(() => {
    if (settling && settled) setSettling(false)
  }, [settling, settled])
  return settling
}

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
 * `repo`: one of the session's copies of repos, by its name, in place of the project: the same
 * read and the same presses, of the copy's own branch.
 */
export function useAgentHandoff(projectId: string, agentId: string | null | undefined, enabled = true, saving = false, working = false, repo?: string): AgentHandoffState {
  // Polled rather than read once: a push or a merge from here (or from a terminal) changes what
  // the branch holds. Not read while the run is live (#1026): a branch still being written to has
  // nothing to hand off yet.
  // A run that works again writes to its branch: the answer remembered from before is not the
  // one shown when the run ends, which would put the last step back for a moment.
  const key = agentId ? `handoff:${projectId}:${agentId}${repo !== undefined ? `:${repo}` : ''}` : undefined
  useEffect(() => {
    if (working && key !== undefined) forgetRemembered(key)
  }, [working, key])
  // How often to ask: every second while the branch is still settling, every fifteen seconds at rest.
  const [everyMs, setEveryMs] = useState(REST_MS)
  const { value: handoff, reload, refresh, state } = usePolled<AgentHandoff | null>(
    enabled && agentId ? () => (repo !== undefined ? onAgentHandoff(projectId, agentId, repo) : onAgentHandoff(projectId, agentId)) : null,
    null,
    everyMs,
    [projectId, agentId, enabled, repo],
    // Remembered per run, in this browser too: going back to a run, or loading it again, shows its
    // last answer at once while it is read again. Another run's answer is never shown.
    key !== undefined ? { remember: key, stored: true } : undefined,
  )
  // The run's turn has just ended: its branch is read every second until it has something to say,
  // since the run's own last commit lands moments after its turn does ({@link SETTLING_MS}).
  const settling = useSettling(working, handoffSays(handoff))
  useEffect(() => setEveryMs(settling ? SETTLING_EVERY_MS : REST_MS), [settling])
  // A quicker pace reads at once, which is how the read the moment a run ends is taken at all; and
  // the clean-up done (`saving` over) may have deleted the branch or pushed it.
  useAskOn(everyMs, refresh)
  useAskOn(saving, reload)
  return { handoff, state }
}

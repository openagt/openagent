import { useEffect, useState } from 'react'
import type { AgentWorktree } from '../../src/index.js'
import { onAgentWorktree } from '../rpc/reads.js'
import { SETTLING_EVERY_MS, useSettling } from './use-agent-handoff.js'
import { useAskOn, usePolled } from './use-async.js'
import { prsAgain } from './runs-changed.js'

/**
 * An agent's checkout, polled: its branch, its pull request, and its checkout while it has one.
 * `null` until its own answer is in, or what was read last time for the same agent. When `turn`
 * changes it is read again at once: the page hands in whether the agent's turn is going, and a turn
 * that ends leaves the checkout clean or dirty right then, not at the next poll up to ten seconds on.
 */
export function useCheckoutStatus(projectId: string, agentId: string, turn?: boolean): AgentWorktree | null {
  // Resting cadence is ten seconds. Right after a turn ends it is read every second for a while, as the branch is: the run's
  // clean-up pushes, opens its pull request and removes its checkout then, and the answer in the
  // middle of that was the bar's for ten seconds.
  const [everyMs, setEveryMs] = useState(10_000)
  const { value: status, refresh } = usePolled<AgentWorktree | null>(
    () => onAgentWorktree(projectId, agentId),
    null,
    everyMs,
    [projectId, agentId],
    // An agent seen before, by this load or an earlier one, shows what was read last time at once,
    // while it is read again. One never seen shows no facts until its own answer: never the
    // previous agent's, which read as this one's for the beat the read took.
    { remember: `worktree:${projectId}:${agentId}`, stored: true },
    // Its pull request moved: read again with the run's row, which says so at the same time.
    prsAgain(),
  )
  const settling = useSettling(turn === true)
  useEffect(() => setEveryMs(settling ? SETTLING_EVERY_MS : 10_000), [settling])
  // A turn that starts or ends is read at once, and the quicker pace after an end waits for that read.
  useAskOn(turn, refresh)
  useAskOn(everyMs, refresh)
  return status
}

import { useEffect, useRef, useState } from 'react'
import type { AgentWorktree } from '../../src/index.js'
import { onAgentWorktree } from '../rpc/reads.js'
import { PR_PENDING_MS, SETTLING_EVERY_MS, SETTLING_MS } from './use-agent-handoff.js'
import { usePolled } from '@openagt/skill-ui/module'

/**
 * An agent's checkout, polled: its branch, its pull request, and its checkout while it has one.
 * `null` until its own answer is in, or what was read last time for the same agent. When `turn`
 * changes it is read again at once: the page hands in whether the agent's turn is going, and a turn
 * that ends leaves the checkout clean or dirty right then, not at the next poll up to ten seconds on.
 */
export function useCheckoutStatus(projectId: string, agentId: string, turn?: boolean): AgentWorktree | null {
  // Resting cadence is ten seconds, but a PR lookup still in flight (#1028) is an answer that
  // lands in under a second — worth asking again for rather than showing a gap for ten.
  // Right after a turn ends it is read every second for a while, as the branch is: the run's
  // clean-up pushes, opens its pull request and removes its checkout then, and the answer in the
  // middle of that was the bar's for ten seconds.
  const [everyMs, setEveryMs] = useState(10_000)
  const [settling, setSettling] = useState(false)
  const { value: status, reload } = usePolled<AgentWorktree | null>(
    () => onAgentWorktree(projectId, agentId),
    null,
    everyMs,
    [projectId, agentId, everyMs],
    // An agent seen before shows what was read last time at once, while it is read again. One
    // never seen shows no facts until its own answer: never the previous agent's, which read as
    // this one's for the beat the read took.
    { remember: `worktree:${projectId}:${agentId}` },
  )
  useEffect(() => setEveryMs(status?.prPending ? PR_PENDING_MS : settling ? SETTLING_EVERY_MS : 10_000), [status?.prPending, settling])
  useEffect(() => {
    if (!settling) return
    const timer = setTimeout(() => setSettling(false), SETTLING_MS)
    return () => clearTimeout(timer)
  }, [settling])
  // Not on the first render, nor when the agent changes: the poll reads then already.
  const seen = useRef<{ key: string; turn: boolean | undefined }>({ key: '', turn })
  useEffect(() => {
    const key = `${projectId}\0${agentId}`
    const changed = seen.current.key === key && seen.current.turn !== turn
    const ended = changed && seen.current.turn === true && !turn
    seen.current = { key, turn }
    if (!changed) return
    // A turn that ends starts the reads every second, and that change of pace reads at once; where
    // the pace stays as it was (already every second, or a request's lookup out), it is read here.
    if (ended) setSettling(true)
    if (!ended || settling || status?.prPending) void reload()
  }, [projectId, agentId, turn, reload, settling, status?.prPending])
  return status
}

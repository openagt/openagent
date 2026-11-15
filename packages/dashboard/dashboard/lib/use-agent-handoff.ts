import { useEffect, useRef, useState } from 'react'
import type { AgentHandoff } from '../../src/index.js'
import { onAgentHandoff } from '../rpc/reads.js'
import { forgetRemembered, useAskOn, usePolled, type ReadState } from './use-async.js'
import { useAction } from './use-action.js'

/** What the agent view knows about the session's branch, and how it acts on it. */
export type AgentHandoffState = {
  handoff: AgentHandoff | null
  /** What is known of the branch: an empty state isn't flashed while it is unknown. */
  state: ReadState
  busy: boolean
  error: string | null
  /** Which button is in flight, so it can say "Opening PR…" rather than silently greying (#948). */
  pending: Press | null
  /**
   * Runs a press. A failure is said as `failed`, the bar's own sentence, then the program's line
   * under it. What `answered` makes of the press's answer is the bar's at once, until the branch is
   * read again. Resolves to the answer, or undefined when the press failed.
   */
  act: <T>(which: Press, fn: () => Promise<T>, failed: string, answered?: (value: Exclude<T, { ok: false }>) => Partial<AgentHandoff> | undefined) => Promise<Exclude<T, { ok: false }> | undefined>
}

/** The bar's presses. */
type Press = 'pr' | 'merge' | 'push' | 'merge-branch' | 'commit'

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
  // How often to ask: every second while the branch is still settling, straight away again while
  // the pull request lookup is out, every fifteen seconds at rest.
  const [everyMs, setEveryMs] = useState(REST_MS)
  const { value: handoff, reload, refresh, state } = usePolled<AgentHandoff | null>(
    enabled && agentId ? () => onAgentHandoff(projectId, agentId) : null,
    null,
    everyMs,
    [projectId, agentId, enabled],
    // Remembered per run, in this browser too: going back to a run, or loading it again, shows its
    // last answer at once while it is read again. Another run's answer is never shown.
    key !== undefined ? { remember: key, stored: true } : undefined,
  )
  // The run's turn has just ended: its branch is read every second until it has something to say,
  // since the run's own last commit lands moments after its turn does ({@link SETTLING_MS}).
  const settling = useSettling(working, handoffSays(handoff))
  useEffect(() => setEveryMs(handoff?.prPending ? PR_PENDING_MS : settling ? SETTLING_EVERY_MS : REST_MS), [handoff?.prPending, settling])
  // A quicker pace reads at once, which is how the read the moment a run ends is taken at all; and
  // the clean-up done (`saving` over) may have deleted the branch or pushed it.
  useAskOn(everyMs, refresh)
  useAskOn(saving, reload)
  const { busy, error, run } = useAction()
  const [pending, setPending] = useState<Press | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // The press's answer over the read it was pressed on, and over a newer one still looking up its
  // pull request (#1028): the first read that knows is the branch's own word. It is its run's alone.
  const [answer, setAnswer] = useState<{ over: AgentHandoff; with: Partial<AgentHandoff>; of: string | undefined } | null>(null)
  const latest = useRef(handoff)
  latest.current = handoff

  const act = async <T,>(which: Press, fn: () => Promise<T>, said: string, answered?: (value: Exclude<T, { ok: false }>) => Partial<AgentHandoff> | undefined) => {
    const of = key
    setPending(which)
    const outcome = await run(fn, said)
    setFailed(outcome.ok ? null : said)
    const over = latest.current
    const known = outcome.ok && over ? answered?.(outcome.value) : undefined
    if (known && over) {
      setAnswer({ over, with: known, of })
      setPending(null)
      void reload()
    } else {
      // The button says what it is doing until the branch is read again: let go before, it read
      // as not pressed for the beat the read takes.
      if (outcome.ok) await reload()
      setPending(null)
    }
    return outcome.ok ? outcome.value : undefined
  }

  const stands = handoff !== null && answer !== null && answer.of === key && (answer.over === handoff || handoff.prPending === true)
  useEffect(() => {
    if (answer && handoff && !stands) setAnswer(null)
  }, [answer, handoff, stands])
  const shown = stands ? { ...handoff, ...answer.with, ...(answer.with.pr ? { prPending: false } : {}) } : handoff
  const said = error === null || failed === null || error === failed ? error : `${failed}\n${error}`
  return { handoff: shown, state, busy, error: said, pending, act }
}

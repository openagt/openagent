import { useEffect, useRef, useState } from 'react'
import { forgetRemembered, rpcClient, useAskOn, usePolled, type ModuleHost, type ReadState } from '@openagt/ui/module'
import type { Handoff, Worktree } from '../src/server.js'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in the project the
// place is drawn in. Each throws the reason a call failed, so a polled read keeps the last answer it had.

export type { Handoff, HandoffCommit, HandoffFile, Pressed, StartFrom, StartPlaces, Worktree } from '../src/server.js'

/** The client of the server part, for a host that calls in a project: a place's (`UiHost`) or a view's (`ModuleHost`). */
export const server = (host: Pick<ModuleHost, 'call'>) => rpcClient<typeof import('../src/server.js')>(host)

/** A run, or one of its copies of repos (`repo`), as a place names it. */
export interface WorkOn {
  projectId: string
  agentId: string
  repo?: string
}

/** How long one read of a run's branch answers every place that asks for it: the bar's summary and each of its offers ask at once. */
const SHARED_MS = 1_000
const shared = new Map<string, { at: number; read: Promise<Handoff | null> }>()

/** What the run's branch, or a copy's, holds: one read shared by the places that ask within a second. */
export function readHandoff(host: Pick<ModuleHost, 'call'>, on: WorkOn): Promise<Handoff | null> {
  const key = `${on.projectId}\n${on.agentId}\n${on.repo ?? ''}`
  const known = shared.get(key)
  if (known && Date.now() - known.at < SHARED_MS) return known.read
  const read = server(host).handoff(on.projectId, { agentId: on.agentId, ...(on.repo !== undefined ? { repo: on.repo } : {}) })
  shared.set(key, { at: Date.now(), read })
  read.catch(() => shared.delete(key))
  return read
}

/** Forget what was read of the run's branch: a press changed it. */
export function forgetHandoff(on: WorkOn): void {
  shared.delete(`${on.projectId}\n${on.agentId}\n${on.repo ?? ''}`)
}

/** How often a branch is read while nothing is moving: a push or a merge from a terminal changes what it says. */
const REST_MS = 15_000

/**
 * How long after a run's turn ends its branch is read every second rather than every fifteen.
 *
 * A clean run makes its own last commit while it cleans up, after its turn has ended, so the first
 * read taken then answers for a branch that holds nothing yet. Waiting a quarter of a minute for
 * the next read is why the row's last step used to arrive late, and why the row itself blinked.
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

/** Where a run stands, as the row it is read for knows it. */
export interface Standing {
  /** The run has ended: a branch still being written to has nothing to hand off yet, so it is read only then. */
  ended: boolean
  /** The run's clean-up is still going: the branch is read again the moment it is done, since it may have deleted an empty branch or pushed one. */
  saving?: boolean
  /** The run works: the answer read before it did is no longer what its branch holds. */
  working?: boolean
}

/**
 * What the run's branch, or a copy's, holds, read once the run has ended, remembered per run in
 * this browser too, so going back to a run, or loading it again, shows its last answer at once
 * while it is read again; another run's answer is never shown. Polled rather than read once: a
 * push or a merge from here (or from a terminal) changes what the branch holds. Read every second
 * while the branch is still settling after a turn ({@link useSettling}), every fifteen at rest.
 */
export function useHandoff(host: ModuleHost, on: WorkOn, { ended, saving = false, working = false }: Standing): { handoff: Handoff | null; state: ReadState } {
  const key = `git-branches:handoff:${on.projectId}:${on.agentId}${on.repo !== undefined ? `:${on.repo}` : ''}`
  // A run that works again writes to its branch: the answer remembered from before is not the
  // one shown when the run ends, which would put the last step back for a moment.
  useEffect(() => {
    if (working) forgetRemembered(key)
  }, [working, key])
  const [everyMs, setEveryMs] = useState(REST_MS)
  const { value, state, reload, refresh } = usePolled<Handoff | null>(ended ? () => readHandoff(host, on) : null, null, everyMs, [on.projectId, on.agentId, on.repo, ended], { remember: key, stored: true })
  // The run's turn has just ended: its branch is read every second until it has something to say,
  // since the run's own last commit lands moments after its turn does.
  const settling = useSettling(working, handoffSays(value))
  useEffect(() => setEveryMs(settling ? SETTLING_EVERY_MS : REST_MS), [settling])
  // A quicker pace reads at once, which is how the read the moment a run ends is taken at all; and
  // the clean-up done (`saving` over) may have deleted the branch or pushed it.
  useAskOn(everyMs, refresh)
  useAskOn(saving, () => {
    forgetHandoff(on)
    return reload()
  })
  return { handoff: value, state }
}

/** How often a run's checkout is read at rest. */
const CHECKOUT_MS = 10_000

/**
 * Where the run works (its checkout, its branch, clean or dirty), polled: `null` until its own
 * answer is in, or what was read last time for the same run. Read again at once when `working`
 * changes: a turn that ends leaves the checkout clean or dirty right then, not at the next poll;
 * and every second for a while after, as the branch is: the run's clean-up pushes and removes its
 * checkout then.
 */
export function useWorktree(host: ModuleHost, projectId: string, agentId: string, working: boolean): Worktree | null {
  const [everyMs, setEveryMs] = useState(CHECKOUT_MS)
  const { value, refresh } = usePolled<Worktree | null>(
    () => server(host).worktree(projectId, { agentId }),
    null,
    everyMs,
    [projectId, agentId],
    // A run seen before, by this load or an earlier one, shows what was read last time at once,
    // while it is read again. One never seen shows no facts until its own answer: never the
    // previous run's, which read as this one's for the beat the read took.
    { remember: `git-branches:worktree:${projectId}:${agentId}`, stored: true },
  )
  const settling = useSettling(working)
  useEffect(() => setEveryMs(settling ? SETTLING_EVERY_MS : CHECKOUT_MS), [settling])
  useAskOn(working, refresh)
  useAskOn(everyMs, refresh)
  return value
}

/** The project's main branch by name, when the work was measured from it; work measured from a commit only knows it as "the main branch". */
export function mainBranchName(base: string | undefined): string {
  return base !== undefined && !/^[0-9a-f]{40}$/.test(base) ? base.replace(/^origin\//, '') : 'the main branch'
}

/**
 * Whether the branch gives the bar above the message box something to say: work it holds
 * (commits, changed files, files left uncommitted), work that was landed, or a branch that is gone
 * with work on it. A run that changed nothing has nothing said, and so no row.
 */
export function handoffSays(handoff: Handoff | null | undefined): boolean {
  if (!handoff) return false
  if (handoff.landed) return true
  if (!handoff.exists) return !handoff.unchanged
  return !handoff.empty || handoff.commits.length > 0 || Boolean(handoff.pendingFiles?.length)
}

import { useEffect, useState } from 'react'
import type { AgentMeta, RecentAgent } from '../../src/index.js'
import { STARTING_AT_MOST_MS } from '../../src/client.js'
import { onAgents, onRecentAgents } from '../rpc/reads.js'
import { usePolled, type ReadState } from './use-async.js'
import { runsAgain, useRunsPace } from './runs-changed.js'
import { usePreferences } from './preferences.js'
import { awaitingName } from './agent-label.js'

// The runs the shell lists, polled: the selected project's agents (live + archived), and every
// project's when all projects show. Owned by the shell so both the Runs rail and the main pane read
// one list: the rail renders the rows, the pane routes the selected agent to its live view or replay
// by that agent's status.
//
// An agent just started (`starting`) is read more often while it is set up: until it is in the
// list, its card names its branch and its name has come. Its card says each step as the runner
// makes it, and at one read every two seconds a step that took one second was never seen, and a
// name that came was shown up to two seconds late. Never for longer than `STARTING_AT_MOST_MS`: an
// agent that runs elsewhere may name no branch here.
const STARTING_EVERY_MS = 400

/**
 * The pace of a list read while a run just started is waited for: `everyMs` from when the run (or
 * its start) is given to the setter, for at most {@link STARTING_AT_MOST_MS}, else `pace`. Another
 * run starts the wait over, and `false` ends it.
 */
function useStartPace(everyMs: number, pace: number): [number, (waited: string | number | false) => void] {
  const [wait, setWait] = useState<string | number | false>(false)
  const [over, setOver] = useState(false)
  useEffect(() => {
    setOver(false)
    if (wait === false) return
    const stop = setTimeout(() => setOver(true), STARTING_AT_MOST_MS)
    return () => clearTimeout(stop)
  }, [wait])
  return [wait !== false && !over ? everyMs : pace, setWait]
}

/** Stable initial for a project's runs, so it does not churn on every render. */
const NO_AGENTS: AgentMeta[] = []

/**
 * `everyMs`: how often the list is read, every two seconds by default, for a run's page whose
 * status a person watches; a page that only shows the list beside it (the Overview) reads it less.
 * While the daemon tells the page of each change of the runs, the list is read at each change, and
 * polled only as a safety (`runs-changed.ts`).
 */
export function useAgents(projectId: string | null, starting: string | null = null, everyMs = 2000): { agents: AgentMeta[]; reload: () => void; state: ReadState } {
  const [pace, waitFor] = useStartPace(STARTING_EVERY_MS, useRunsPace(everyMs))
  // Kept for the next visit: the rail shows the project's last list at once, while it is read again.
  const { value: agents, reload, state } = usePolled<AgentMeta[]>(
    projectId ? () => onAgents(projectId) : null,
    NO_AGENTS,
    pace,
    [projectId],
    projectId ? { remember: `agents:${projectId}`, stored: true } : undefined,
    runsAgain(projectId ?? undefined),
  )
  const naming = usePreferences().nameRuns !== false
  const started = starting === null ? undefined : agents.find(agent => agent.id === starting)
  const settingUp =
    projectId !== null && starting !== null && (started === undefined || (started.status === 'running' && started.branch === undefined) || awaitingName(started, naming))
  const waited = settingUp && starting
  useEffect(() => waitFor(waited), [waited, waitFor])
  // A fresh `state` is what lets the shell tell a session that is gone from one it has not read yet
  // (#784): a bookmarked link must not flash "gone" while the first read is still out, nor while
  // only an earlier visit's list is shown.
  return { agents, reload, state }
}

/** Stable initial for the cross-project recents poll, so it does not churn on every render. */
const NO_RECENTS: RecentAgent[] = []

/**
 * Every project's runs, pooled for the sidebar when all projects show (#shared-shell): read only
 * while `shown`, since a picked project's own agents carry its rail. Every ten seconds, but a run
 * just started (`started`) is read every second until its row and its name are in, as a project's
 * own list reads it: the name is the first thing a person waits on. Only for a run just started:
 * one that never shows in that list (it runs on another machine) is not read for again each time
 * the list is shown.
 */
export function useRecentAgents(shown: boolean, started: { id: string | null; projectId: string | null; at: number }): { recentAgents: RecentAgent[]; reload: () => Promise<void>; state: ReadState } {
  const [pace, waitFor] = useStartPace(1000, useRunsPace(10_000))
  const { value: recentAgents, reload, state } = usePolled<RecentAgent[]>(shown ? onRecentAgents : null, NO_RECENTS, pace, [shown], { remember: 'recent-agents', stored: true }, runsAgain(undefined))
  const naming = usePreferences().nameRuns !== false
  const row = started.id === null ? undefined : recentAgents.find(recent => recent.agent.id === started.id && recent.projectId === started.projectId)
  const waited = shown && started.id !== null && Date.now() - started.at < STARTING_AT_MOST_MS && (row === undefined || awaitingName(row.agent, naming))
  useEffect(() => waitFor(waited ? started.at : false), [waited, started.at, waitFor])
  return { recentAgents, reload, state }
}

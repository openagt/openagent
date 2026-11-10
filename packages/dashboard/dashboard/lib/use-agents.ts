import { useEffect } from 'react'
import type { AgentMeta, RecentAgent } from '../../src/index.js'
import { onAgents, onRecentAgents } from '../rpc/reads.js'
import { usePolled } from './use-async.js'
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
const STARTING_AT_MOST_MS = 30_000

/**
 * Read again every `everyMs` while a run just started is waited for (`waited` is set), for at most
 * {@link STARTING_AT_MOST_MS}. A new value of `waited` starts the wait over.
 */
function useStartWait(waited: string | boolean | null, read: () => unknown, everyMs: number): void {
  useEffect(() => {
    if (!waited) return
    const timer = setInterval(() => void read(), everyMs)
    const stop = setTimeout(() => clearInterval(timer), STARTING_AT_MOST_MS)
    return () => {
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [waited, read, everyMs])
}

/**
 * `everyMs`: how often the list is read, every two seconds by default, for a run's page whose
 * status a person watches; a page that only shows the list beside it (the Overview) reads it less.
 * While the daemon tells the page of each change of the runs, the list is read at each change, and
 * polled only as a safety (`runs-changed.ts`).
 */
export function useAgents(projectId: string | null, starting: string | null = null, everyMs = 2000): { agents: AgentMeta[]; reload: () => void; loaded: boolean } {
  // `reload` is the shared guarded one now: it used to be a second, unguarded copy of the
  // read, so an agent started just before a project switch could write the old project's agents.
  const { value: agents, reload, loaded } = usePolled<AgentMeta[]>(
    projectId ? () => onAgents(projectId) : null,
    [],
    useRunsPace(everyMs),
    [projectId],
    undefined,
    runsAgain(projectId ?? undefined),
  )
  const naming = usePreferences().nameRuns !== false
  const started = starting === null ? undefined : agents.find(agent => agent.id === starting)
  const settingUp =
    projectId !== null && starting !== null && (started === undefined || (started.status === 'running' && started.branch === undefined) || awaitingName(started, naming))
  useStartWait(settingUp && starting, reload, STARTING_EVERY_MS)
  // `loaded` is what lets the shell tell a session that is gone from one it has not read yet
  // (#784): a bookmarked link must not flash "gone" while the first read is still out.
  return { agents, reload, loaded }
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
export function useRecentAgents(shown: boolean, started: { id: string | null; projectId: string | null; at: number }): { recentAgents: RecentAgent[]; reload: () => Promise<void>; loaded: boolean } {
  const { value: recentAgents, reload, loaded } = usePolled<RecentAgent[]>(shown ? onRecentAgents : null, NO_RECENTS, useRunsPace(10_000), [shown], undefined, runsAgain(undefined))
  const naming = usePreferences().nameRuns !== false
  const row = started.id === null ? undefined : recentAgents.find(recent => recent.agent.id === started.id && recent.projectId === started.projectId)
  const waited = shown && started.id !== null && Date.now() - started.at < STARTING_AT_MOST_MS && (row === undefined || awaitingName(row.agent, naming))
  useStartWait(waited, reload, 1000)
  return { recentAgents, reload, loaded }
}

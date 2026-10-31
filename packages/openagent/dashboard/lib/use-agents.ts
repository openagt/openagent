import { useEffect } from 'react'
import type { AgentMeta } from '../../src/index.js'
import { onAgents } from '../rpc/reads.js'
import { usePolled } from '@openagt/skill-ui/module'
import { runsAgain, useRunsPace } from './runs-changed.js'
import { usePreferences } from './preferences.js'
import { awaitingName } from './agent-label.js'

// The selected project's agents (live + archived), polled. Owned by the shell (+Page) so both
// the Runs rail and the main pane read one list: the rail renders the rows, the pane routes
// the selected agent to its live view or replay by that agent's status.
//
// An agent just started (`starting`) is read more often while it is set up: until it is in the
// list, its card names its branch and its name has come. Its card says each step as the runner
// makes it, and at one read every two seconds a step that took one second was never seen, and a
// name that came was shown up to two seconds late. Never for longer than `STARTING_AT_MOST_MS`: an
// agent that runs elsewhere may name no branch here.
export const STARTING_EVERY_MS = 400
export const STARTING_AT_MOST_MS = 30_000

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
  useEffect(() => {
    if (!settingUp) return
    const timer = setInterval(() => void reload(), STARTING_EVERY_MS)
    const stop = setTimeout(() => clearInterval(timer), STARTING_AT_MOST_MS)
    return () => {
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [settingUp, starting, reload])
  // `loaded` is what lets the shell tell a session that is gone from one it has not read yet
  // (#784): a bookmarked link must not flash "gone" while the first read is still out.
  return { agents: agents, reload, loaded }
}

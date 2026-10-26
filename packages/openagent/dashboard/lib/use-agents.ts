import { useEffect } from 'react'
import type { AgentMeta } from '../../src/index.js'
import { onAgents } from '../rpc/reads.js'
import { usePolled } from './use-async.js'
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

/** How long the runs read for one part of the page serve another that asks for them: the cards on the Overview, the rail beside them. */
const SHARED_MS = 3000

/** Each project's runs as last asked for: the answer, or the read on its way, and when it was asked. */
const lastRead = new Map<string, { at: number; agents: Promise<AgentMeta[]> }>()

/**
 * A project's runs, every part of the page reading them through here. `fresh` asks the daemon
 * now (the rail's own poll, which must see a run just started); otherwise a read on its way or one
 * answered within {@link SHARED_MS} is the answer, so the Overview's cards and the rail ask once.
 */
export function readAgents(projectId: string, { fresh = false }: { fresh?: boolean } = {}): Promise<AgentMeta[]> {
  const last = lastRead.get(projectId)
  if (!fresh && last && Date.now() - last.at < SHARED_MS) return last.agents
  const read = { at: Date.now(), agents: onAgents(projectId) }
  lastRead.set(projectId, read)
  // A failed read is not handed to the next asker.
  read.agents.catch(() => void (lastRead.get(projectId) === read && lastRead.delete(projectId)))
  return read.agents
}

/**
 * `everyMs`: how often the list is read, every two seconds by default, for a run's page whose
 * status a person watches; a page that only shows the list beside it (the Overview) reads it less.
 */
export function useAgents(projectId: string | null, starting: string | null = null, everyMs = 2000): { agents: AgentMeta[]; reload: () => void; loaded: boolean } {
  // `reload` is the shared guarded one now: it used to be a second, unguarded copy of the
  // read, so an agent started just before a project switch could write the old project's agents.
  const { value: agents, reload, loaded } = usePolled<AgentMeta[]>(
    projectId ? () => readAgents(projectId, { fresh: true }) : null,
    [],
    everyMs,
    [projectId],
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

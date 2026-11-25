import { hostname } from 'node:os'
import type { AgentMeta } from '../store/index.js'
import { cachedPrStates, type PrStates } from './pull-requests.js'

// A run's row, as the dashboard's lists show it (dashboard-rpc/reads.ts): the run as its host says
// it, with what the modules read of it beside marked on it (its pull request's state), and whether
// it is another computer's. Kept apart from the RPCs that serve
// the rows, since every function an RPC module exports is a call the page can make.

/**
 * What a run's row marks beside its name, for both lists of runs, a project's and all projects'
 * together: how its pull request stands. The work it left on this machine is a waiting item of
 * the module that says it (`app.attention`), which the row shows from there.
 */
export async function withRowMarks(cwd: string, agents: AgentMeta[]): Promise<AgentMeta[]> {
  return withPrStates(cwd, agents)
}

/**
 * Each run that has a pull request, marked with how the request stands, so its row can show it, and
 * with its title, so the jump finds the run by it: from one cached listing of the project's
 * requests, read only when one of the runs has a request.
 */
export async function withPrStates(cwd: string, agents: AgentMeta[], states: (cwd: string) => Promise<PrStates> = cachedPrStates): Promise<AgentMeta[]> {
  if (!agents.some(agent => agent.pr !== undefined || agent.earlierPrs?.length)) return agents
  const known = await states(cwd)
  return agents.map(agent => {
    const listed = agent.pr && known.get(agent.pr.url)
    const earlierPrs = agent.earlierPrs?.map(pr => {
      const state = known.get(pr.url)?.state
      return state ? { ...pr, state } : pr
    })
    return listed || earlierPrs ? { ...agent, ...(listed ? { prState: listed.state, ...(listed.title ? { prTitle: listed.title } : {}) } : {}), ...(earlierPrs ? { earlierPrs } : {}) } : agent
  })
}

/**
 * A run another machine's daemon started is marked as from another host (#1648): the data branch
 * is shared precisely so other machines' runs show up here, and a row that looked exactly like
 * one of this daemon's own sent the user reading the archive by hand to learn whose it was. A run
 * with no recorded host predates the field and passes through untouched.
 */
export function markOtherHost(agent: AgentMeta, thisHost: string = hostname()): AgentMeta {
  if (agent.host === undefined || agent.host === thisHost) return agent
  return { ...agent, otherHost: true }
}

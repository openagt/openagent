import { hostname } from 'node:os'
import { repositoryAddress } from '@openagt/agent-data'
import type { AgentMeta, BranchesFor } from '../store/index.js'
import { pullRequestState, requestedBranches, takesRequests } from './pr-states.js'
import { unpublishedRuns, type Unpublished } from './unpublished.js'

// A run's row, as the dashboard's lists show it (dashboard-rpc/reads.ts): the run as its host says
// it, with what the modules read of it beside marked on it (its pull request's state, the work it
// left on this machine), and whether it is another computer's. Kept apart from the RPCs that serve
// the rows, since every function an RPC module exports is a call the page can make.

/**
 * What a run's row marks beside its name, for both lists of runs, a project's and all projects'
 * together: how its pull request stands, and the work it left on this machine.
 */
export async function withRowMarks(cwd: string, agents: AgentMeta[]): Promise<AgentMeta[]> {
  return withUnpublished(cwd, withPrStates(agents))
}

/** How a request stands, as the modules last read it (`pr-states.ts`). */
type PrStates = { get(url: string): { state: NonNullable<AgentMeta['prState']>; title?: string } | undefined }

/**
 * Each run that has a pull request, marked with how the request stands, so its row can show it, and
 * with its title, so the jump finds the run by it: as the modules last read the requests at their
 * git host.
 */
export function withPrStates(agents: AgentMeta[], known: PrStates = { get: pullRequestState }): AgentMeta[] {
  if (!agents.some(agent => agent.pr !== undefined || agent.earlierPrs?.length)) return agents
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
 * Each finished run whose work never left this machine, marked with how many files it left
 * uncommitted and how many commits wait, so its row can say so as the Human Queue does: the same
 * rule, {@link unpublishedRuns}. A provider that cannot be read marks nothing.
 */
export async function withUnpublished(cwd: string, agents: AgentMeta[], branches?: BranchesFor): Promise<AgentMeta[]> {
  // A branch with an open request is published, as the modules last read the requests.
  const requested = async () => ((await takesRequests(await repositoryAddress(cwd).catch(() => undefined))) ? requestedBranches() : undefined)
  const found = await unpublishedRuns(cwd, agents, branches, requested).catch(() => new Map<string, Unpublished>())
  if (found.size === 0) return agents
  return agents.map(agent => {
    const work = found.get(agent.id)
    if (!work) return agent
    return { ...agent, ...(work.commits > 0 ? { unpublished: work.commits } : {}), ...(work.uncommitted > 0 ? { uncommitted: work.uncommitted } : {}) }
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

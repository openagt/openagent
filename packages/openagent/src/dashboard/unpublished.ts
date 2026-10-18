import type { AgentMeta } from '../store/index.js'
import { projectBranches, type BranchAhead, type BranchesFor } from '../store/branches.js'
import { agentBranchFor } from './agent-handoff.js'

/**
 * A finished run's work that never left this machine: the branch it is on, the commits it holds
 * that were never published, and the files its checkout left uncommitted. Either count may be 0,
 * never both.
 */
export interface Unpublished {
  branch: string
  commits: number
  uncommitted: number
}

/**
 * The finished runs of a project whose work never left this machine (#860), by run id: what the
 * Human Queue lists as "Not committed" and "Not published" and the list of runs marks on each row,
 * read alike so the two never disagree.
 *
 * Only a branch the branches provider made for the run counts. A branch of the person's own is
 * theirs: a run continued on it, or a branch made before the history was rewritten, which is
 * thousands of commits past the base.
 *
 * Files its checkout left uncommitted wait on the person whatever else is true of the branch: the
 * run's next step is to commit them, a pull request or none. Not for a run waiting on its question,
 * which is that run's next step, and which keeps its checkout as it was. The checkout on a branch is
 * the newest run's: a run continued on the branch of an earlier one works in a checkout of its own,
 * and what it leaves there is not the earlier run's.
 *
 * Commits wait when they are the branch's own beyond the base, not in the default branch, never
 * pushed, in a project with a remote to push to. A branch pushed once whose copy on the remote is
 * gone since, as a merged pull request's is, left the machine. So did a run with a pull request: its
 * request is what the queue and its row show, and a branch pushed without an upstream reads, once
 * its request merged and the remote's copy went, as never pushed.
 *
 * Every run is asked, in one quick read of the provider (`ahead`: counts, no file lists). A run
 * started from another branch is asked apart, from the commit it started at, or that branch's work
 * would count as its own; a run started from the default branch is counted from it, which already
 * leaves out whatever it took in later, so the commit it started at changes nothing and all such
 * runs share one read. A subagent's branch is its main agent's to land, never a person's to push,
 * and a run still working is still writing its branch. A provider that cannot be found, or does not
 * answer for every branch asked, throws: "nothing waits" would be a false answer.
 */
export async function unpublishedRuns(cwd: string, agents: readonly AgentMeta[], branches: BranchesFor = projectBranches): Promise<Map<string, Unpublished>> {
  const finished = agents.flatMap(agent => {
    const branch = agentBranchFor(agent)
    return branch === undefined || agent.status === 'running' || agent.parent !== undefined ? [] : [{ agent, branch }]
  })
  const found = new Map<string, Unpublished>()
  if (finished.length === 0) return found
  // No provider: the project has no checkouts and no branch state to read; nothing is waiting.
  const source = await branches(cwd)
  if (!source) return found
  const fromOf = (agent: AgentMeta): string | undefined => (agent.base !== undefined ? agent.baseCommit : undefined)
  const asks = new Map<string | undefined, string[]>()
  for (const { agent, branch } of finished) asks.set(fromOf(agent), [...new Set([...(asks.get(fromOf(agent)) ?? []), branch])])
  const counts = new Map<string, BranchAhead>()
  for (const answered of await Promise.all([...asks].map(async ([from, asked]) => ({ from, asked, states: await source.ahead(asked, from) })))) {
    if (answered.states.length !== answered.asked.length) throw new Error('the branches provider did not answer for every branch')
    for (const state of answered.states) counts.set(`${answered.from ?? ''}\0${state.branch}`, state)
  }
  // The newest run on each branch, working or not: the one whose checkout is on it.
  const newest = new Map<string, AgentMeta>()
  for (const agent of agents) {
    const branch = agentBranchFor(agent)
    const known = branch === undefined ? undefined : newest.get(branch)
    if (branch !== undefined && (!known || agent.startedAt > known.startedAt)) newest.set(branch, agent)
  }
  for (const { agent, branch } of finished) {
    const state = counts.get(`${fromOf(agent) ?? ''}\0${branch}`)
    if (!state || !state.exists || !state.agent) continue
    const uncommitted = agent.status === 'waiting' || newest.get(branch) !== agent ? 0 : state.uncommitted
    const commits = agent.pr === undefined && state.ahead > 0 && !state.merged && !state.pushed && !state.gone && state.hasRemote ? state.ahead : 0
    if (uncommitted > 0 || commits > 0) found.set(agent.id, { branch, commits, uncommitted })
  }
  return found
}

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
 * which is that run's next step, and which keeps its checkout as it was.
 *
 * Commits wait when they are the branch's own beyond the base, not in the default branch, never
 * pushed, in a project with a remote to push to. A branch pushed once whose copy on the remote is
 * gone since, as a merged pull request's is, left the machine. So did a run with a pull request: its
 * request is what the queue and its row show, and a branch pushed without an upstream reads, once
 * its request merged and the remote's copy went, as never pushed.
 *
 * Every run is asked, in one quick read of the provider (`ahead`: counts, no file lists) per
 * commit the runs started from, the runs that name none sharing one. A subagent's branch is its
 * main agent's to land, never a person's to push, and a run still working is still writing its
 * branch. A provider that cannot be found throws; one whose read fails answers nothing.
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
  const asks = new Map<string | undefined, string[]>()
  for (const { agent, branch } of finished) asks.set(agent.baseCommit, [...(asks.get(agent.baseCommit) ?? []), branch])
  const counts = new Map<string, BranchAhead>()
  for (const answered of await Promise.all([...asks].map(async ([from, asked]) => ({ from, states: await source.ahead(asked, from) })))) {
    for (const state of answered.states) counts.set(`${answered.from ?? ''}\0${state.branch}`, state)
  }
  for (const { agent, branch } of finished) {
    const state = counts.get(`${agent.baseCommit ?? ''}\0${branch}`)
    if (!state || !state.exists || !state.agent) continue
    const uncommitted = agent.status === 'waiting' ? 0 : state.uncommitted
    const commits = agent.pr === undefined && state.ahead > 0 && !state.merged && !state.pushed && !state.gone && state.hasRemote ? state.ahead : 0
    if (uncommitted > 0 || commits > 0) found.set(agent.id, { branch, commits, uncommitted })
  }
  return found
}

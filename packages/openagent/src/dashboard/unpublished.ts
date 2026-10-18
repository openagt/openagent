import type { AgentMeta } from '../store/index.js'
import { projectBranches, type BranchAhead, type BranchesFor } from '../store/branches.js'
import { agentBranchFor } from './agent-handoff.js'

/** A finished run's work that never left this machine: the branch it is on and how many commits. */
export interface Unpublished {
  branch: string
  commits: number
}

/**
 * The finished runs of a project whose work never left this machine (#860), by run id: what the
 * Human Queue lists as "Not published" and the list of runs marks on each row, read alike so the
 * two never disagree.
 *
 * Such a run's branch is one the branches provider made for it, has commits of its own beyond
 * the base, is not in the default branch, and was never pushed, in a project with a remote to push
 * to. A branch pushed once whose copy on the remote is gone since, as a merged pull request's is,
 * left the machine. A branch of the person's own is theirs to publish: a run continued on it, or a
 * branch made before the history was rewritten, which is thousands of commits past the base.
 *
 * Every run is asked, in one quick read of the provider (`ahead`: counts, no files) per commit the
 * runs started from, the runs that name none sharing one. A subagent's branch is its main agent's
 * to land, never a person's to push, and a run still working is still writing its branch. A run
 * with a pull request has published: its request is what the queue and its row show, and a branch
 * pushed without an upstream reads, once its request merged and the remote's copy went, as never
 * pushed. A provider that cannot be found throws; one whose read fails answers nothing.
 */
export async function unpublishedRuns(cwd: string, agents: readonly AgentMeta[], branches: BranchesFor = projectBranches): Promise<Map<string, Unpublished>> {
  const finished = agents.flatMap(agent => {
    const branch = agentBranchFor(agent)
    return branch === undefined || agent.status === 'running' || agent.parent !== undefined || agent.pr !== undefined ? [] : [{ agent, branch }]
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
    if (!state || !state.exists || !state.agent || state.ahead === 0 || state.merged || state.pushed || state.gone || !state.hasRemote) continue
    found.set(agent.id, { branch, commits: state.ahead })
  }
  return found
}

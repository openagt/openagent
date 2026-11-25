import { projectBranches, type AgentMeta, type AgentStatus, type BranchesFor } from './store/index.js'

/** A retained worktree and the agent that left it behind (#752). */
export interface WorktreeRow {
  /** The agent id. */
  agentId: string
  /** The branch the agent's work landed on, when its meta recorded one (#799). */
  branch?: string
  /** How the agent that left this checkout ended, or `running` while it is still going. */
  status?: AgentStatus
  /** Size on disk in bytes, absent for a live agent (its tree is still changing) or when unreadable. */
  sizeBytes?: number
  /** True while the agent owning this checkout is still going: it is in use, not retained. */
  live: boolean
}

/**
 * The worktrees a project still has on disk (#752), newest first — the same view the dashboard's
 * retained-worktrees list is built from, so the CLI is a second surface rather than a second
 * behaviour. The checkouts are what the project's branches provider lists (#1774), each with its
 * run as the run's host says it (`runs`); a project with no provider has none.
 *
 * A live agent's checkout is included and flagged rather than hidden: "what is this directory and
 * why can I not remove it" is exactly the question the list has to answer.
 */
export async function listProjectWorktrees(cwd: string, runs: readonly AgentMeta[], opts: { sizes?: boolean } = {}, branches: BranchesFor = projectBranches): Promise<WorktreeRow[]> {
  const source = await branches(cwd).catch(() => undefined)
  if (!source) return []
  // Sizing a tree an agent is writing to gives a number that is wrong by the time it prints;
  // a caller that only wants the rows (the dashboard's retained list) skips the du entirely.
  const checkouts = await source.list(opts.sizes === false ? {} : { sizes: true }).catch(() => [])
  const rows: WorktreeRow[] = []
  for (const checkout of checkouts) {
    const meta = runs.find(agent => agent.id === checkout.id)
    const isLive = meta?.status === 'running'
    rows.push({
      agentId: checkout.id,
      live: isLive,
      ...(meta?.branch ? { branch: meta.branch } : {}),
      ...(meta?.status ? { status: meta.status } : {}),
      ...(!isLive && checkout.sizeBytes !== undefined ? { sizeBytes: checkout.sizeBytes } : {}),
    })
  }
  return rows.sort((a, b) => (a.agentId < b.agentId ? 1 : a.agentId > b.agentId ? -1 : 0))
}

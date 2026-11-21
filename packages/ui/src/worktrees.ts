import { errorMessage } from './error-message.js'
import { isRunId, listAgents, projectBranches, projectRuns, readLiveMetas, type AgentStatus, type BranchesFor, type RunsFor } from './store/index.js'

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

/** The outcome of {@link removeProjectWorktree}. */
export type RemoveResult =
  | {
      ok: true
      /**
       * Branches that went with the checkout: the branch it was on, when that held nothing of
       * its own (#1650); the run-id branch the agent branched away from, when everything on
       * it is in the branch that stays (#1657). Absent when nothing went.
       */
      branchesDeleted?: string[]
    }
  | { ok: false; error: string }

/**
 * The worktrees a project still has on disk (#752), newest first — the same view the dashboard's
 * retained-worktrees list is built from, through the same store reads, so the CLI is a second
 * surface rather than a second behaviour. The checkouts are what the project's branches provider
 * lists (#1774); a project with no provider has none.
 *
 * A live agent's checkout is included and flagged rather than hidden: "what is this directory and
 * why can I not remove it" is exactly the question the list has to answer.
 */
export async function listProjectWorktrees(cwd: string, opts: { sizes?: boolean } = {}, branches: BranchesFor = projectBranches): Promise<WorktreeRow[]> {
  const source = await branches(cwd).catch(() => undefined)
  if (!source) return []
  const [checkouts, live, archived] = await Promise.all([
    // Sizing a tree an agent is writing to gives a number that is wrong by the time it prints;
    // a caller that only wants the rows (the dashboard's retained list) skips the du entirely.
    source.list(opts.sizes === false ? {} : { sizes: true }).catch(() => []),
    readLiveMetas(cwd, undefined, branches).catch(() => []),
    listAgents(cwd).catch(() => []),
  ])
  const rows: WorktreeRow[] = []
  for (const checkout of checkouts) {
    const meta = live.find(agent => agent.id === checkout.id) ?? archived.find(agent => agent.id === checkout.id)
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

/**
 * Remove one retained worktree (#752/#737/E5): the one implementation behind every surface that
 * removes one: the dashboard's Remove button (#982). The run's own tool reclaims a finished run's
 * checkout by the same rule; this is for the checkouts that rule kept.
 *
 * **One rule: only what is committed may go**: the rule is the branches provider's, whose
 * `remove` takes a clean checkout and leaves its branch on this machine, pushing nothing
 * (#1774); its refusal is answered in its own words.
 *
 * Refuses while the agent is still going — an agent's checkout is where its agent is working, and Stop
 * is how you end an agent, not pulling the floor out from under it.
 */
export async function removeProjectWorktree(cwd: string, agentId: string, branches: BranchesFor = projectBranches): Promise<RemoveResult> {
  if (!isRunId(agentId)) return { ok: false, error: `invalid session id: ${agentId}` }
  const live = await readLiveMetas(cwd, undefined, branches).catch(() => [])
  const agent = live.find(agent => agent.id === agentId)
  if (agent?.status === 'running') {
    return { ok: false, error: 'that session is still going; stop it before removing its worktree' }
  }
  const source = await branches(cwd).catch(() => undefined)
  if (!source) return { ok: false, error: 'no package of this project provides its checkouts' }
  try {
    // The commit the run's branch started from, when its card names one: a branch with no commit
    // past it goes with the checkout, and one with its own work stays.
    return await source.remove(agentId, agent?.baseCommit !== undefined ? { from: agent.baseCommit } : {})
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/** The outcome of {@link deleteProjectAgent}. */
export type DeleteAgentResult = { ok: true } | { ok: false; error: string }

/** Where {@link deleteProjectAgent} reads: the project's providers by default. */
export interface DeleteAgentOptions {
  /** Where the project's finished runs are read and removed; the project's runs provider by default. */
  runs?: RunsFor
  /** Where the project's checkouts are read and removed; the project's branches provider by default. */
  branches?: BranchesFor
}

/**
 * Delete a session (#1032): take it out of the dashboard, records and all.
 *
 * This is the sibling of {@link removeProjectWorktree}, and the difference is the whole point.
 * Remove-worktree reclaims the checkout on disk and keeps the session — its row, its replayable
 * log — because the run is recorded on the data branch. Delete removes that record too: the card
 * (`<id>.json`, what the rail lists) and the diary (`<id>.jsonl`, what replays), so the row is
 * gone for good. It is the one destructive-of-history action, which is
 * why the surfaces that call it confirm first. The run is on the data branch, so its deletion is
 * itself a committed, pushed change.
 *
 * What it deliberately leaves is git's, not the dashboard's: the branch `agent-<id>`
 * (or the name the agent gave it) and its commits. Deleting a branch that may carry merged work
 * or an open PR is not a thing a
 * dashboard action should do silently, so the branch stays and delete means "remove from the
 * dashboard", not "erase every trace".
 *
 * Refuses while the agent is still going — Stop is how an agent ends. Any uncommitted work in the
 * worktree is discarded with it, which is the intent here (the session is being thrown away),
 * unlike remove-worktree, which refuses a checkout holding uncommitted work: the branches
 * provider's `remove --discard` (#1774).
 */
export async function deleteProjectAgent(cwd: string, agentId: string, opts: DeleteAgentOptions = {}): Promise<DeleteAgentResult> {
  if (!isRunId(agentId)) return { ok: false, error: `invalid session id: ${agentId}` }
  const branches = opts.branches ?? projectBranches
  const live = await readLiveMetas(cwd, undefined, branches).catch(() => [])
  if (live.some(agent => agent.id === agentId && agent.status === 'running')) {
    return { ok: false, error: 'that session is still going; stop it before deleting it' }
  }
  try {
    // The checkout first, if the provider lists one: removed with its uncommitted work (it goes
    // with the session), where remove-worktree would have refused it.
    const source = await branches(cwd).catch(() => undefined)
    if (source && (await source.list().catch(() => [])).some(checkout => checkout.id === agentId)) {
      const removed = await source.remove(agentId, { discard: true })
      if (!removed.ok) return removed
    }
    // Then the record that put the row in the list: the finished run, removed through the
    // project's runs provider (#1582/#1769). Tolerant of an absent record, and of a project with
    // no provider, so a half-deleted session (its worktree already gone) still finishes cleanly.
    const runs = await (opts.runs ?? projectRuns)(cwd).catch(() => undefined)
    if (runs && (await runs.list()).some(card => card.id === agentId)) {
      const removed = await runs.remove(agentId)
      if (!removed.ok) return { ok: false, error: removed.error }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

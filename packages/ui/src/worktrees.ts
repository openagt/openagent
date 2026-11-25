import { errorMessage } from './error-message.js'
import { deleteRun, findRun } from '@openagt/agent-driver'
import { isRunId, projectBranches, type AgentMeta, type BranchesFor } from './store/index.js'

/** The outcome of {@link deleteProjectAgent}. */
export type DeleteAgentResult = { ok: true } | { ok: false; error: string }

/** Where {@link deleteProjectAgent} reads: the project's providers by default. */
export interface DeleteAgentOptions {
  /** Where the project's checkouts are read and removed; the project's branches provider by default. */
  branches?: BranchesFor
}

/**
 * Delete a session (#1032): take it out of the dashboard, records and all.
 *
 * This is the sibling of git-branches' Remove worktree, and the difference is the whole point.
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
export async function deleteProjectAgent(cwd: string, agentId: string, agent?: Pick<AgentMeta, 'status'>, opts: DeleteAgentOptions = {}): Promise<DeleteAgentResult> {
  if (!isRunId(agentId)) return { ok: false, error: `invalid session id: ${agentId}` }
  const branches = opts.branches ?? projectBranches
  if (agent?.status === 'running') {
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
    // Then the record that put the row in the list: the finished run, removed from the project's
    // records (#1582/#1769). Tolerant of an absent record, so a half-deleted session (its worktree
    // already gone) still finishes cleanly.
    if (await findRun(cwd, agentId).catch(() => undefined)) {
      const removed = await deleteRun(cwd, agentId)
      if (!removed.ok) return { ok: false, error: removed.error }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

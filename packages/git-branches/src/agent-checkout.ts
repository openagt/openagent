import { basename } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import type { GitRunner } from '@openagt/agent-data'
import { agentBranchName, agentIdFromWorktreeDir } from './branch-names.js'
import { discardWorktree, reclaimWorktree, type ReclaimOutcome } from './reclaim.js'
import { worktreePath } from './worktree.js'

// One agent's checkout, by the agent's id: reclaimed or dropped, as the command line's `remove`
// and `prune` do it and a project removed with its files does (`cleanup.ts`).

/** A refusal `remove` and `prune` can add to the reclaim rule's own: there is no such checkout. */
export type RemoveRefusal = { ok: false; reason: 'no-checkout'; agentId: string }

/**
 * The directory of agent `agentId`'s checkout, as it really is; none when there is no such
 * directory. The argument may be the session name a rename link carries rather than the id: the
 * link leads to the checkout itself.
 */
async function checkoutDir(repo: string, agentId: string): Promise<string | undefined> {
  const path = worktreePath(repo, agentId)
  return (await stat(path).then(s => s.isDirectory(), () => false)) ? realpath(path) : undefined
}

/**
 * One agent's checkout under the reclaim rule; a missing checkout is its own refusal. The birth
 * branch is read off the checkout's own directory, never off the argument (#1757): a link's
 * name is the branch the agent chose, and that one is not the birth branch.
 */
export async function reclaimAgent(repo: string, agentId: string, git: GitRunner, from?: string): Promise<ReclaimOutcome | RemoveRefusal> {
  const checkout = await checkoutDir(repo, agentId)
  if (checkout === undefined) return { ok: false, reason: 'no-checkout', agentId }
  return reclaimWorktree(repo, checkout, { birthBranch: agentBranchName(agentIdFromWorktreeDir(basename(checkout))), ...(from !== undefined ? { from } : {}), git })
}

/** One agent's checkout dropped whatever it holds; a missing checkout is its own refusal. */
export async function discardAgent(repo: string, agentId: string, git: GitRunner): Promise<ReclaimOutcome | RemoveRefusal> {
  const checkout = await checkoutDir(repo, agentId)
  if (checkout === undefined) return { ok: false, reason: 'no-checkout', agentId }
  return discardWorktree(repo, checkout, { git })
}

/** Why a checkout stayed, as one line for a person. */
export function refusalLine(agentId: string, outcome: Extract<ReclaimOutcome, { ok: false }> | RemoveRefusal): string {
  switch (outcome.reason) {
    case 'no-checkout':
      return `no checkout for agent ${agentId}`
    case 'not-a-worktree':
      return `agent ${agentId}'s directory is not a git worktree; left alone`
    case 'no-branch':
      return `agent ${agentId}'s checkout is on no branch; kept`
    case 'dirty':
      return `${outcome.branch} has uncommitted work; the checkout was kept`
  }
}

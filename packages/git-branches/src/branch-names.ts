import { DATA_BRANCH } from '@openagt/agent-data/names'

/**
 * The naming rules for everything the package mints in git, and the layout they imply under
 * `.branches/` (the directory is `@openagt/agent-data`'s convention).
 * Pure: no node imports, so browser-safe code can name branches too.
 */

/**
 * An agent id is path-safe — no separators or traversal, only our own charset — and is not `data`:
 * `agent-data` is the shared data branch of `@openagt/agent-data`, checked out beside the agent
 * checkouts as `.branches/agent-data`, and an agent of that id would be indistinguishable from it.
 */
export function isSafeAgentId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id) && agentBranchName(id) !== DATA_BRANCH
}

/**
 * What every branch the package mints is named under. Slash-free on purpose: a `/` in a ref name
 * never resolves as a cloud session's revision (anthropics/claude-code#87235), and it is what
 * lets a checkout directory be named exactly as its branch.
 */
export const AGENT_BRANCH_PREFIX = 'agent-'

/**
 * The branch a checkout is created on: `agent-<agent id>`. The agent id exists before the session
 * name does, so the branch is created from the id and renamed once the agent picks a name. It is
 * also the checkout directory's name under `.branches/`, so the listing reads as branch names.
 */
export function agentBranchName(agentId: string): string {
  return `${AGENT_BRANCH_PREFIX}${agentId}`
}

/** The inverse of {@link agentBranchName}: the agent id a checkout directory's name carries. */
export function agentIdFromWorktreeDir(name: string): string {
  return name.slice(AGENT_BRANCH_PREFIX.length)
}

/**
 * Whether a branch is one the package minted for an agent: the branch a checkout was created on,
 * or the session-named `agent-<name>` it was renamed to. The only branches the package ever
 * renames or deletes; a branch of the user's own is out of reach by name alone, and so is the
 * data branch, `agent-data`, which carries the prefix without being anyone's.
 */
export function isAgentBranch(name: string): boolean {
  return name.startsWith(AGENT_BRANCH_PREFIX) && name !== DATA_BRANCH
}

/**
 * The session name a checkout's branch carries: `agent-<session name>` minus the prefix. The name
 * is read off the branch and never recorded beside it — a checkout has one branch, and that
 * branch is the name. Undefined for a branch the package did not mint, and while the agent has
 * not named its session: the branch is still the one the checkout was created on, which the
 * agent id names — a caller without an id has no such branch to rule out.
 */
export function sessionNameOf(branch: string | undefined, agentId: string | undefined): string | undefined {
  if (!branch || !isAgentBranch(branch) || (agentId !== undefined && branch === agentBranchName(agentId))) return undefined
  return branch.slice(AGENT_BRANCH_PREFIX.length)
}

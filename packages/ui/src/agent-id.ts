/**
 * An agent's id, derived from the moment it starts. Pure — no node imports — because the sweep
 * that mints ids ahead of a claim (#1748) is reachable from the dashboard's browser bundle.
 */

/** Filesystem-safe, lexicographically-sortable agent id from an ISO start time. */
export function agentIdFromStartedAt(startedAt: string): string {
  // ISO is fixed-width, so replacing the `:`/`.` separators keeps lexical order
  // in step with chronological order — the history list sorts by id alone.
  return startedAt.replace(/[:.]/g, '-')
}

/**
 * The inverse of {@link agentIdFromStartedAt}, for a caller that has the id but not the meta
 * (#1251): picking which PR is the agent's needs the start time to tell the agent's own PR from a
 * predecessor's on the same branch name. Undefined for an id that is not one of ours.
 */
export function startedAtFromAgentId(id: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(id)
  return match ? `${match[1]}:${match[2]}:${match[3]}.${match[4]}Z` : undefined
}

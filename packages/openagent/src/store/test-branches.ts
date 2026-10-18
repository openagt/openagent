import type { BranchesFor, BranchesSource, BranchState, Checkout } from './branches.js'

/**
 * A branches provider as a test would have it: the checkouts of every project held in memory,
 * answering what a real provider's command would. `writes` records every publish, merge and
 * remove; a remove takes the checkout out of the list, the way the command would.
 */
export function testBranches(byProject: Record<string, Checkout[]> = {}, states: BranchState[] = []): BranchesFor & { writes: string[] } {
  const writes: string[] = []
  const checkouts = new Map(Object.entries(byProject).map(([root, rows]) => [root, [...rows]]))
  const sourceFor = (root: string): BranchesSource => ({
    async list() {
      return [...(checkouts.get(root) ?? [])]
    },
    async show(branches) {
      return branches.flatMap(branch => states.filter(state => state.branch === branch))
    },
    // The counts a real provider would give of the same states: a run's branch is `agent-*`.
    async ahead(branches) {
      return branches.flatMap(branch =>
        states
          .filter(state => state.branch === branch)
          .map(state => ({ branch, exists: state.exists, agent: branch.startsWith('agent-'), ahead: state.commits.length, hasRemote: state.hasRemote, pushed: state.pushed, gone: false, merged: state.merged })),
      )
    },
    async push(branch) {
      writes.push(`push ${branch}`)
      return { ok: true, pushed: true }
    },
    async merge(branch) {
      writes.push(`merge ${branch}`)
      return { ok: true, into: 'main', commit: 'c'.repeat(40), from: 'b'.repeat(40), deleted: true }
    },
    async remove(id, opts = {}) {
      writes.push(`remove ${id}${opts.discard ? ' --discard' : ''}`)
      const rows = checkouts.get(root) ?? []
      if (!rows.some(row => row.id === id)) return { ok: false, error: `no checkout for agent ${id}` }
      checkouts.set(
        root,
        rows.filter(row => row.id !== id),
      )
      return { ok: true }
    },
  })
  return Object.assign(async (root: string) => (checkouts.has(root) ? sourceFor(root) : undefined), { writes })
}

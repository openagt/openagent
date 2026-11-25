import { runName, type AttentionItem, type RunSummary } from '@openagt/hooks'
import type { BranchAhead } from './branch-ahead.js'

/**
 * A finished run's work that never left this machine: the branch it is on, the commits it holds
 * that were never pushed, and the files its checkout left uncommitted. Either count may be 0,
 * never both.
 */
export interface Unpublished {
  branch: string
  commits: number
  uncommitted: number
}

/** How far the project's branches are past their base, measured from `from` when it is given (`readBranchesAhead`). */
export type AheadOf = (branches: readonly string[], from?: string) => Promise<BranchAhead[]>

/** The run's branch, as its facts name it: the one the agent left its work on. */
const branchOf = (run: RunSummary): string | undefined => run.facts?.['git-branches']?.branch

/**
 * The finished runs of a project whose work never left this machine (#860), by run id: what every
 * list of what waits says as "Needs commit" and "Needs push", and the list of runs marks on each row.
 *
 * Only a branch this package made for the run counts. A branch of the person's own is theirs: a
 * run continued on it, or a branch made before the history was rewritten, which is thousands of
 * commits past the base.
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
 * request is what the lists show, and a branch pushed without an upstream reads, once its request
 * merged and the remote's copy went, as never pushed. A pushed branch that waits for a pull request
 * is the git host's to say.
 *
 * Every run is asked, in one quick read (`ahead`: counts, no file lists). A run started from
 * another branch is asked apart, from the commit it started at, or that branch's work would count
 * as its own; a run started from the default branch is counted from it, which already leaves out
 * whatever it took in later, so all such runs share one read. A run still working is still writing
 * its branch. A read that does not answer for every branch asked throws: "nothing waits" would be
 * a false answer.
 */
export async function unpublishedRuns(runs: readonly RunSummary[], ahead: AheadOf): Promise<Map<string, Unpublished>> {
  const finished = runs.flatMap(run => {
    const branch = branchOf(run)
    return branch === undefined || run.status === 'working' ? [] : [{ run, branch }]
  })
  const found = new Map<string, Unpublished>()
  if (finished.length === 0) return found
  const fromOf = (run: RunSummary): string | undefined => (run.options?.['git-branches']?.base !== undefined ? run.facts?.['git-branches']?.baseCommit : undefined)
  const asks = new Map<string | undefined, string[]>()
  for (const { run, branch } of finished) asks.set(fromOf(run), [...new Set([...(asks.get(fromOf(run)) ?? []), branch])])
  const counts = new Map<string, BranchAhead>()
  for (const answered of await Promise.all([...asks].map(async ([from, asked]) => ({ from, asked, states: await ahead(asked, from) })))) {
    if (answered.states.length !== answered.asked.length) throw new Error('the branches were not all read')
    for (const state of answered.states) counts.set(`${answered.from ?? ''}\0${state.branch}`, state)
  }
  // The newest run on each branch, working or not: the one whose checkout is on it.
  const newest = new Map<string, RunSummary>()
  for (const run of runs) {
    const branch = branchOf(run)
    const known = branch === undefined ? undefined : newest.get(branch)
    if (branch !== undefined && (!known || run.startedAt > known.startedAt)) newest.set(branch, run)
  }
  for (const { run, branch } of finished) {
    const state = counts.get(`${fromOf(run) ?? ''}\0${branch}`)
    if (!state || !state.exists || !state.agent) continue
    const uncommitted = run.status === 'waiting' || newest.get(branch) !== run ? 0 : state.uncommitted
    const own = run.facts?.github?.pr === undefined && state.ahead > 0 && !state.merged && !state.gone && state.hasRemote
    const commits = own && !state.pushed ? state.ahead : 0
    if (uncommitted > 0 || commits > 0) found.set(run.id, { branch, commits, uncommitted })
  }
  return found
}

/**
 * What waits on the person in the runs' work never published, as items (`app.attention`): files
 * left uncommitted first, since committing them is the run's next step, else commits never pushed.
 * Committing the files is a new step from publishing them, and is said anew once they are.
 */
export function unpublishedItems(runs: readonly RunSummary[], found: ReadonlyMap<string, Unpublished>): AttentionItem[] {
  return runs.flatMap((run): AttentionItem[] => {
    const work = found.get(run.id)
    if (!work) return []
    const left =
      work.uncommitted > 0
        ? { id: `uncommitted:${run.id}`, words: 'Needs commit', detail: counted(work.uncommitted, 'file'), mark: 'changes' as const }
        : { id: `unpushed:${run.id}`, words: 'Needs push', detail: counted(work.commits, 'commit'), mark: 'branch' as const }
    const since = run.endedAt ?? run.startedAt
    return [{ kind: 'waiting', scope: 'run', run: run.id, ...left, title: runName(run, work.branch) ?? work.branch, since }]
  })
}

/** `1 file`, `3 commits`. */
function counted(n: number, what: string): string {
  return `${n} ${what}${n === 1 ? '' : 's'}`
}

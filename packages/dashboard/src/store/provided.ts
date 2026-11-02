import { lookupProvided } from '../built-in.js'
import { projectBranches } from './branches.js'
import { projectGitHost } from './git-host.js'
import { projectQueue } from './queue.js'
import { projectRuns } from './runs.js'
import { projectTickets } from './tickets.js'

/**
 * A package's command just ran in the project at `root` (a module's, through the dashboard), and
 * may have written what one of OpenAgent's provided readers caches. Given the package, only what
 * that package provides is forgotten: a card reading the queue leaves the runs read, so the next
 * read of the runs is not made again for nothing. With no package, every provided reader forgets
 * that project. Its next read runs the provider again; forgetting is cheap.
 */
export function providedDataChanged(root: string, pkg?: string): void {
  projectBranches.changed(root, pkg)
  projectGitHost.changed(root, pkg)
  projectQueue.changed(root, pkg)
  projectRuns.changed(root, pkg)
  projectTickets.changed(root, pkg)
}

/** The kinds of OpenAgent's data a project's package may provide, one reader each (`git-host` is `git-host.ts`). */
export const PROVIDED_KINDS = ['tickets', 'queue', 'runs', 'branches', 'git-host', 'repository'] as const

/**
 * Why a kind of the project's data has no provider although packages declare it (#1820): two or
 * more declare the kind and the project's package.json names none, or names one that does not
 * declare it. One sentence per such kind, for the project's error banner; none when every kind is
 * settled. Nobody declaring a kind is not a problem: the project has none of that data.
 */
export async function providerProblems(root: string): Promise<string[]> {
  const problems: string[] = []
  for (const kind of PROVIDED_KINDS) {
    const { problem } = await lookupProvided(root, kind).catch((): { problem?: string } => ({}))
    if (problem) problems.push(problem)
  }
  return problems
}

import { inRepo } from '@openagt/hooks/command'
import { nodeBranchFileFs, openProjectReader } from '@openagt/store-filesystem'
import { runsRootOf } from '@openagt/git-branches'
import type { GitRunner } from '@openagt/hooks'
import { RUNS_DIR, readCard, runEntries, runsPath, type ListedRun, type RecordsReader } from '@openagt/agent-driver'
import { peopleOf, readCommitLines, type PersonActivity } from './people.js'

// The reads the command prints and the package's own pages show, from wherever they are read: a
// project, or the sessions with no project (the sessions home).

/** Where a read finds the runs: the records it goes through, and the runs' directory in them. */
export interface RunsAt {
  reader: RecordsReader
  dir: string
}

/**
 * The records a read goes through: origin's copy, fetched once, or with `local` this machine's, the
 * writer's checkout read where it lies, with no fetch. From a project or the sessions home; from
 * anywhere else, a refusal.
 */
export async function records(cwd: string, local: boolean | undefined, git: GitRunner): Promise<RunsAt> {
  const root = await inRepo(() => runsRootOf(cwd, git))
  if (!local) return { reader: await openProjectReader(cwd, { git }), dir: RUNS_DIR }
  const files = nodeBranchFileFs()
  return { reader: { list: files.list, read: path => files.read(path).catch(() => undefined) }, dir: await runsPath(root, git) }
}

/**
 * The runs, newest first and no more than `limit`, each with the person it is kept under; with a
 * `branch`, only the runs on it. The cards past the cap are never read.
 */
export async function newestRuns({ reader, dir }: RunsAt, limit: number, branch?: string): Promise<ListedRun[]> {
  const cards: ListedRun[] = []
  for (const run of await runEntries(reader, dir)) {
    if (cards.length >= limit) break
    const card = await readCard(reader, dir, run)
    if (!card || (branch !== undefined && card.branch !== branch)) continue
    cards.push({ ...card, person: run.person })
  }
  return cards
}

/**
 * Who works in the project at `cwd`: each person who started runs since `since` or committed to its
 * main branch, the one git commits as here marked as them.
 */
export async function peopleAt(cwd: string, since: number, local: boolean | undefined, git: GitRunner): Promise<PersonActivity[]> {
  const [email, name] = await Promise.all(['user.email', 'user.name'].map(async key => (await git(['config', key], cwd).catch(() => '')).trim()))
  const me = email ? { email, ...(name ? { name } : {}) } : undefined
  // The main branch's commits, newest first: the default branch as origin names it, else what is checked out.
  const main = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd).catch(() => '')).trim() || 'HEAD'
  const commits = readCommitLines(await git(['log', main, '-n', '5000', '--format=%ae%x09%an%x09%at'], cwd).catch(() => ''))
  const { reader, dir } = await records(cwd, local, git)
  return peopleOf(reader, dir, since, me, commits)
}

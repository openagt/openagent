import { inRepo } from '@openagt/hooks/command'
import { nodeBranchFileFs, openProjectReader } from '@openagt/store-filesystem'
import { runsRootOf } from '@openagt/git-branches'
import type { GitRunner } from '@openagt/hooks'
import { dirname, join } from 'node:path'
import { COPIES_DIR, RUNS_DIR, findEntry, newestFirst, readCard, runEntries, runsPath, type ListedRun, type RecordsReader, type RunEntry } from '@openagt/agent-driver'
import { peopleOf, readCommitLines, type PersonActivity } from './people.js'

// The reads the command prints and the package's own pages show, from wherever they are read: a
// project, or the sessions with no project (the sessions home).

/**
 * Where a read finds the runs: the records it goes through, the runs' directory in them, and the
 * directory of the sessions with no project that had a copy of the project (`COPIES_DIR`).
 */
export interface RunsAt {
  reader: RecordsReader
  dir: string
  copies: string
}

/** A run as the list gives it: with `noProject`, a session with no project that had a copy of this one. */
export type ListedRunHere = ListedRun & { noProject?: true }

/**
 * The records a read goes through: origin's copy, fetched once, or with `local` this machine's, the
 * writer's checkout read where it lies, with no fetch. From a project or the sessions home; from
 * anywhere else, a refusal.
 */
export async function records(cwd: string, local: boolean | undefined, git: GitRunner): Promise<RunsAt> {
  const root = await inRepo(() => runsRootOf(cwd, git))
  if (!local) return { reader: await openProjectReader(cwd, { git }), dir: RUNS_DIR, copies: COPIES_DIR }
  const files = nodeBranchFileFs()
  const dir = await runsPath(root, git)
  return { reader: { list: files.list, read: path => files.read(path).catch(() => undefined) }, dir, copies: join(dirname(dir), COPIES_DIR) }
}

/**
 * The runs, newest first and no more than `limit`, each with the person it is kept under, and the
 * sessions with no project that had a copy of the project among them, each marked so; with a
 * `branch`, only the runs on it. The cards past the cap are never read.
 */
export async function newestRuns({ reader, dir, copies }: RunsAt, limit: number, branch?: string): Promise<ListedRunHere[]> {
  // A session with no project has no branch here: none is on one.
  const own = (await runEntries(reader, dir)).map(run => ({ ...run, at: dir }))
  const copied = branch === undefined ? (await runEntries(reader, copies)).map(run => ({ ...run, at: copies })) : []
  const cards: ListedRunHere[] = []
  for (const run of newestFirst([...own, ...copied])) {
    if (cards.length >= limit) break
    const card = await readCard(reader, run.at, run)
    if (!card || (branch !== undefined && card.branch !== branch)) continue
    cards.push({ ...card, person: run.person, ...(run.at === copies ? { noProject: true as const } : {}) })
  }
  return cards
}

/** One run with where it is kept: among the project's own, else among the sessions with no project that had a copy of it. */
export async function runAt({ reader, dir, copies }: RunsAt, id: string): Promise<{ at: string; run: RunEntry; noProject: boolean } | undefined> {
  const own = await findEntry(reader, dir, id)
  if (own) return { at: dir, run: own, noProject: false }
  const copy = await findEntry(reader, copies, id)
  return copy && { at: copies, run: copy, noProject: true }
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

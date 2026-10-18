import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { isAgentBranch } from './branch-names.js'
import { commitOf, detectBase } from './branch-state.js'
import { repoHasRemote } from './worktree.js'

/**
 * How far each branch is past the base, and whether origin has it: the quick read beside
 * {@link readBranchStates}, for a caller that asks about every run's branch on a poll. It counts
 * commits and lists no file: a branch made before the repository's history was rewritten is
 * thousands of commits and files past the base, and listing its files is what made a read of
 * every branch take seconds. Every branch is answered by one `git for-each-ref`, however many are
 * asked.
 */
export interface BranchAhead {
  branch: string
  /** The branch exists in the repository. Gone: nothing else is true of it. */
  exists: boolean
  /** A branch this package made for an agent (`agent-*`, the data branch aside). */
  agent: boolean
  /** How many of its own commits it has beyond the base: the fewer of the counts from the commit the caller named and from the default branch, so neither another branch's work nor what it took in from the default branch is counted. */
  ahead: number
  /** The repository has a remote. */
  hasRemote: boolean
  /** `origin` has the branch at this same tip. */
  pushed: boolean
  /** It was pushed with its upstream set and `origin`'s copy is gone since, as after a pull request merged and its branch was deleted. */
  gone: boolean
  /** The default branch already contains it. */
  merged: boolean
}

/** Fields of one `for-each-ref` line; a ref name cannot hold it. */
const SEP = String.fromCharCode(31)

/**
 * Each branch named, in that order. `from` is the commit they were made at, when the caller knows
 * it; one this machine does not have counts from the default branch alone.
 */
export async function readBranchesAhead(repo: string, branches: readonly string[], git: GitRunner = nodeGitRunner(), from?: string): Promise<BranchAhead[]> {
  const ask = (args: string[]): Promise<string> => git(args, repo).catch(() => '')
  const [hasRemote, base, start] = await Promise.all([repoHasRemote(repo, git), detectBase(ask), from !== undefined ? commitOf(ask, from) : undefined])
  const bases = [base, start].flatMap(rev => (rev === undefined ? [] : [rev]))
  const refs = await readRefs(ask, bases)
  // A git older than the `ahead-behind` atom (2.41) refuses it: the branches asked, and only those,
  // are then counted by a `rev-list` each, side by side.
  await Promise.all(
    [...new Set(branches)].map(async branch => {
      const local = refs.get(`refs/heads/${branch}`)
      if (local && !local.past) local.past = await Promise.all(bases.map(async rev => Number((await ask(['rev-list', '--count', `${rev}..${local.tip}`])).trim())))
    }),
  )
  return branches.map(branch => {
    const local = refs.get(`refs/heads/${branch}`)
    if (!local) return { branch, exists: false, agent: isAgentBranch(branch), ahead: 0, hasRemote, pushed: false, gone: false, merged: false }
    const past = local.past ?? []
    return {
      branch,
      exists: true,
      agent: isAgentBranch(branch),
      // The fewer of the two counts: from the named commit and from the default branch.
      ahead: past.length > 0 ? Math.min(...past) : 0,
      hasRemote,
      pushed: hasRemote && refs.get(`refs/remotes/origin/${branch}`)?.tip === local.tip,
      gone: local.gone,
      merged: base !== undefined && past[0] === 0,
    }
  })
}

interface Ref {
  tip: string
  gone: boolean
  /** Commits past each base, the default branch's first: absent until counted. */
  past?: number[]
}

/**
 * Every local branch and every branch of origin's this machine knows, by its full name: one
 * `for-each-ref`, its `ahead-behind` atoms counting from each base. A git that refuses the atom
 * answers the refs alone, uncounted.
 */
async function readRefs(ask: (args: string[]) => Promise<string>, bases: readonly string[]): Promise<Map<string, Ref>> {
  const plain = ['%(refname)', '%(objectname)', '%(upstream:track)']
  const read = (fields: string[]): Promise<string> => ask(['for-each-ref', `--format=${fields.join(SEP)}`, 'refs/heads/', 'refs/remotes/origin/'])
  const counted = await read([...plain, ...bases.map(rev => `%(ahead-behind:${rev})`)])
  const refs = new Map<string, Ref>()
  for (const line of (counted || (await read(plain))).split('\n')) {
    const [name, tip, track, ...counts] = line.split(SEP)
    if (!name || !tip) continue
    // `<ahead> <behind>` per base.
    refs.set(name, { tip, gone: track === '[gone]', ...(counted ? { past: counts.map(count => Number(count.split(' ')[0])) } : {}) })
  }
  return refs
}

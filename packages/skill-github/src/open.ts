import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { errorMessage, nodeGhRunner, type GhRunner } from './gh.js'
import { armMerge, type MergeArming, type WatchStarter } from './merge.js'
import { openRequestOf } from './requests.js'
import { pushFork } from './home.js'

/**
 * Opening a pull request (#1820): the agent's own step after its branch is pushed, and
 * OpenAgent's on a person's Open PR. The words are the caller's; a branch that already has an
 * open request gets no second one, and only the merge arming happens. Pushing is not here: the
 * branches package pushes, this package asks GitHub. A branch pushed to a fork, where origin's
 * push address is one, is opened from that fork.
 */

export interface OpenOptions {
  /** The branch; the working directory's current branch when absent. */
  branch?: string
  /** One line naming what the change does. */
  title: string
  /** What changed, and why. */
  body?: string
  /** Open as a draft. Not with `merge`: a draft cannot be merged. */
  draft?: boolean
  /** Arm the merge: the request lands on its own once its checks pass. */
  merge?: boolean
  git?: GitRunner
  gh?: GhRunner
  watch?: WatchStarter
}

export type OpenOutcome =
  | { ok: true; branch: string; request: { number: number; url: string }; existing: boolean; merge?: MergeArming }
  /** The working directory is on no branch and none was named. */
  | { ok: false; reason: 'no-branch' }
  /** GitHub would not open the request: gh's own line. */
  | { ok: false; reason: 'open-failed'; branch: string; detail: string }
  /** The request is open, but its merge could not be armed. */
  | { ok: false; reason: 'merge-failed'; branch: string; request: { number: number; url: string }; detail: string }

/** The current branch of a directory, or undefined when detached or outside a repository. */
export async function currentBranch(cwd: string, git: GitRunner): Promise<string | undefined> {
  try {
    const name = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim()
    return name && name !== 'HEAD' ? name : undefined
  } catch {
    return undefined
  }
}

/** The number in a request's URL, as gh prints it after `pr create`. */
export function requestNumber(url: string | undefined): number | undefined {
  const match = url?.match(/\/pull\/(\d+)(?:$|[/?#])/)
  return match ? Number(match[1]) : undefined
}

export async function openRequest(cwd: string, opts: OpenOptions): Promise<OpenOutcome> {
  const git = opts.git ?? nodeGitRunner()
  const gh = opts.gh ?? nodeGhRunner()
  const branch = opts.branch ?? (await currentBranch(cwd, git))
  if (!branch) return { ok: false, reason: 'no-branch' }

  let request = await openRequestOf(cwd, branch, gh)
  let existing = true
  if (!request) {
    existing = false
    try {
      const fork = await pushFork(cwd, git)
      const args = ['pr', 'create', '--head', fork !== undefined ? `${fork.split('/')[0]}:${branch}` : branch, '--title', opts.title, '--body', opts.body ?? '']
      if (opts.draft && !opts.merge) args.push('--draft')
      const out = await gh(args, cwd)
      const url = out.trim().split('\n').filter(Boolean).at(-1)
      const number = requestNumber(url)
      request = url && number !== undefined ? { number, url } : await openRequestOf(cwd, branch, gh)
      if (!request) return { ok: false, reason: 'open-failed', branch, detail: 'gh printed no pull request URL' }
    } catch (err) {
      return { ok: false, reason: 'open-failed', branch, detail: errorMessage(err) }
    }
  }
  if (!opts.merge) return { ok: true, branch, request, existing }
  const merge = await armMerge(cwd, request.number, gh, opts.watch)
  if (merge.outcome === 'failed') return { ok: false, reason: 'merge-failed', branch, request, detail: merge.error }
  return { ok: true, branch, request, existing, merge }
}

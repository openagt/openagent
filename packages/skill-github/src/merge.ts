import { errorMessage } from '@openagt/agent-data'
import { nodeGhRunner, type GhRunner } from './gh.js'
import { spawnMergeWatch } from './merge-watch.js'

/**
 * Landing a pull request (#1820): armed to merge on green where the repository allows GitHub's
 * auto-merge; merged at once where GitHub says the request is already green; where the repository
 * allows no auto-merge, this package's own watcher waits for the checks and merges. Two doors on
 * the same arming: `open --merge`, the agent's, and `merge <number>`, a person's or the scheduler's,
 * which marks a draft ready first.
 */

/** How arming a merge went. */
export type MergeArming = { outcome: 'auto-armed' | 'merged' | 'watching' } | { outcome: 'failed'; error: string }

/** Start the merge watcher for a request; the default starts this package's own process. For tests. */
export type WatchStarter = (repo: string, number: number) => Promise<void>

/**
 * GitHub's words for "auto-merge is not allowed in this repository" and for "this request is
 * already green, so there is nothing to wait for". Matched loosely on purpose: a rephrase on
 * GitHub's side lands in `failed`, said out loud, never in a wrong merge.
 */
const AUTO_MERGE_OFF = /auto[- ]?merge is not allowed/i
const ALREADY_GREEN = /clean status/i

export async function armMerge(repo: string, number: number, gh: GhRunner, watch: WatchStarter = spawnMergeWatch): Promise<MergeArming> {
  try {
    await gh(['pr', 'merge', String(number), '--squash', '--auto'], repo)
    return { outcome: 'auto-armed' }
  } catch (err) {
    const refusal = errorMessage(err)
    try {
      if (ALREADY_GREEN.test(refusal)) {
        await gh(['pr', 'merge', String(number), '--squash'], repo)
        return { outcome: 'merged' }
      }
      if (AUTO_MERGE_OFF.test(refusal)) {
        await watch(repo, number)
        return { outcome: 'watching' }
      }
    } catch (next) {
      return { outcome: 'failed', error: errorMessage(next) }
    }
    return { outcome: 'failed', error: refusal }
  }
}

/** What landing a request did: armed as `open --merge` arms, or why not. */
export type MergeOutcome = MergeArming | { outcome: 'not-open'; state: string }

export interface MergeOptions {
  gh?: GhRunner
  watch?: WatchStarter
}

/**
 * Land a pull request: "it is good, land it". A draft is marked ready first, since asking for the
 * merge is the statement that its review happened; then the merge is armed exactly as
 * `open --merge` arms it. A request that is not open is `not-open` with its state: already merged
 * is an answer, not an action.
 */
export async function mergeRequest(repo: string, number: number, opts: MergeOptions = {}): Promise<MergeOutcome> {
  const gh = opts.gh ?? nodeGhRunner()
  let view: { state?: unknown; isDraft?: unknown }
  try {
    view = JSON.parse(await gh(['pr', 'view', String(number), '--json', 'state,isDraft'], repo)) as typeof view
  } catch (err) {
    return { outcome: 'failed', error: errorMessage(err) }
  }
  const state = typeof view.state === 'string' ? view.state : 'OPEN'
  if (state !== 'OPEN') return { outcome: 'not-open', state }
  if (view.isDraft === true) {
    try {
      await gh(['pr', 'ready', String(number)], repo)
    } catch (err) {
      return { outcome: 'failed', error: errorMessage(err) }
    }
  }
  return armMerge(repo, number, gh, opts.watch ?? spawnMergeWatch)
}

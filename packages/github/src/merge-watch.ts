import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRANCHES_DIR, errorMessage } from '@openagt/agent-data'
import type { GhRunner } from './gh.js'

/**
 * Merge on green where the repository does not allow GitHub auto-merge: a small process of this
 * tool's own that waits for one pull request's checks and merges it once they pass. It holds
 * nothing but the number: the pull request on GitHub is the whole state, so a watcher that dies
 * (a reboot) leaves an open request a person can merge, never a wrong merge.
 */

/** Where a pull request's checks stand, summarised to the question the merge asks. */
export type ChecksState = 'passing' | 'failing' | 'pending' | 'none'

/** How long a pull request with no checks waits for its checks to attach before it counts as green. */
export const NO_CHECKS_GRACE_MS = 2 * 60_000
/** How often the checks are read. */
export const WATCH_EVERY_MS = 60_000
/** How long a watcher waits at most: a suite still pending after this is left to a person. */
export const WATCH_FOR_MS = 6 * 60 * 60_000

/** Under `.branches/`: one log per watched pull request. Not a checkout name, so nothing lists it. */
export const WATCH_LOG_DIR = 'merge-on-green'

export type WatchOutcome =
  | { outcome: 'merged' }
  /** Merged or closed by someone else meanwhile. */
  | { outcome: 'closed'; state: string }
  | { outcome: 'checks-failed'; failed: string[] }
  | { outcome: 'timed-out' }
  | { outcome: 'failed'; error: string }

interface PrView {
  state: string
  checks: ChecksState
  failed: string[]
}

/**
 * One read of the pull request: its state and its checks, GitHub Actions check runs and classic
 * commit statuses alike. Skipped and neutral count as passing, as GitHub's own merge box counts
 * them; a cancelled or timed-out check is not evidence the work is good, so it counts as failed.
 * A read gh cannot answer is `pending`: acting on an unreadable status must never merge.
 */
export async function readPr(repo: string, number: number, gh: GhRunner): Promise<PrView> {
  interface RollupEntry {
    name?: string
    status?: string
    conclusion?: string
    context?: string
    state?: string
  }
  let parsed: { state?: string; statusCheckRollup?: RollupEntry[] }
  try {
    parsed = JSON.parse(await gh(['pr', 'view', String(number), '--json', 'state,statusCheckRollup'], repo)) as typeof parsed
  } catch {
    return { state: 'OPEN', checks: 'pending', failed: [] }
  }
  const state = typeof parsed.state === 'string' ? parsed.state : 'OPEN'
  const rollup = Array.isArray(parsed.statusCheckRollup) ? parsed.statusCheckRollup : []
  if (rollup.length === 0) return { state, checks: 'none', failed: [] }
  const passing = /^(SUCCESS|NEUTRAL|SKIPPED)$/
  let pending = false
  const failed: string[] = []
  for (const entry of rollup) {
    // A classic status has no `status` field: its `state` is both progress and verdict.
    const verdict = entry.conclusion ?? entry.state ?? ''
    const done = entry.status ? entry.status === 'COMPLETED' : verdict !== 'PENDING' && verdict !== 'EXPECTED'
    if (!done) pending = true
    else if (!passing.test(verdict)) failed.push(entry.name ?? entry.context ?? 'unnamed check')
  }
  return { state, checks: failed.length > 0 ? 'failing' : pending ? 'pending' : 'passing', failed }
}

export interface WatchOptions {
  gh: GhRunner
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  everyMs?: number
  forMs?: number
  graceMs?: number
  log?: (line: string) => void
}

/**
 * Wait for the pull request's checks, then merge it (squash). Red ends the watch with the request
 * left open for a person; a request merged or closed meanwhile ends it too. No checks at all is
 * green once the grace has passed: a repository without CI has nothing to wait for.
 */
export async function watchAndMerge(repo: string, number: number, opts: WatchOptions): Promise<WatchOutcome> {
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const log = opts.log ?? (() => {})
  const started = now()
  for (;;) {
    const pr = await readPr(repo, number, opts.gh)
    const elapsed = now() - started
    log(`[github] #${number}: ${pr.state}, checks ${pr.checks}`)
    if (pr.state !== 'OPEN') return { outcome: 'closed', state: pr.state }
    if (pr.checks === 'failing') return { outcome: 'checks-failed', failed: pr.failed }
    if (pr.checks === 'passing' || (pr.checks === 'none' && elapsed >= (opts.graceMs ?? NO_CHECKS_GRACE_MS))) {
      try {
        await opts.gh(['pr', 'merge', String(number), '--squash'], repo)
        return { outcome: 'merged' }
      } catch (err) {
        return { outcome: 'failed', error: errorMessage(err) }
      }
    }
    if (elapsed >= (opts.forMs ?? WATCH_FOR_MS)) return { outcome: 'timed-out' }
    await sleep(opts.everyMs ?? WATCH_EVERY_MS)
  }
}

/** This package's executable, beside `dist/`. */
const BIN = fileURLToPath(new URL('../bin/github', import.meta.url))

/**
 * Start the watcher for one pull request as its own process, detached, so it outlives the agent
 * that published: `github watch <number>` at the project root, its log under
 * `.branches/merge-on-green/<number>.log`. Resolves once the process exists.
 */
export async function spawnMergeWatch(repo: string, number: number): Promise<void> {
  const dir = join(repo, BRANCHES_DIR, WATCH_LOG_DIR)
  mkdirSync(dir, { recursive: true })
  const fd = openSync(join(dir, `${number}.log`), 'a')
  const child = spawn(process.execPath, [BIN, 'watch', String(number)], { cwd: repo, detached: true, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  child.unref()
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
}

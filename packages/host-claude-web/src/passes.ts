import { hostname } from 'node:os'
import type { GitRunner, ProjectRef } from '@openagt/hooks'
import { listRequests, type GhRunner } from '@openagt/github'
import type { AnyDiaryLine, RecordDeps, RunCard } from '@openagt/agent-driver'
import { endUnmade, handingOff } from './hand-off.js'
import { githubAccount } from './github.js'
import { SESSION_WINDOW_MS, projectWebRuns, updateWebRun, type WebRun } from './web-runs.js'

/**
 * What follows a web run once its hand-off is over, a pass over each project every few minutes
 * (#1601, #1547, #1668), for the runs this computer handed off:
 *
 * - **Its branch**: the cloud session works on a branch of its own naming (`claude/*`), never told
 *   to the run. The run's start is an empty commit of its own, so the session's branch, and only
 *   it, descends from it: the one of origin's `claude/*` branches that does is the run's, recorded
 *   on its record with the pull request the session opened for it. None, or more than one, is the
 *   next pass's question.
 * - **Its end**: the run reads as working while its session may be, until the session opened a
 *   pull request, or the session window passed.
 * - **Its start's branch**: once its session's branch is found, or a day after the start, the
 *   branch the start was pushed to is deleted from origin, only while it still is the run's start:
 *   one a person pushed to is theirs. Not before: the session made says nothing of its clone
 *   being over, and a branch deleted under a session still cloning strands it.
 * - **A hand-off that ended with OpenAgent**: a run whose session was never made, and whose
 *   hand-off is under way nowhere, failed.
 */

/** How long after its start a run's session's branch is looked for: safely past any cloud session's life. */
export const ADOPTION_WINDOW_MS = 48 * 60 * 60 * 1000

/** How long a run's start's branch stays on origin when its session's branch was never found: past any session's clone. */
export const START_BRANCH_KEPT_MS = 24 * 60 * 60 * 1000

/** Where a cloud session's own branches are. */
const CLOUD_BRANCHES = 'claude/'

/** Where the pass keeps origin's `claude/*` branches in the project's clone. */
const CLOUD_HEADS = 'refs/remotes/origin/claude/'

/** What a pass works with; the real one when absent. */
export interface PassDeps {
  /** One of OpenAgent's GitHub accounts, as git with origin and `gh` work as it. */
  account?: (dir: string, account: string | undefined) => Promise<{ git: GitRunner; gh: GhRunner }>
  /** The newest pull request of `branch` created since `since`; none when it has none. Throws when GitHub cannot say. */
  prOf?: (dir: string, branch: string, since: string, gh: GhRunner) => Promise<{ number: number; url: string } | undefined>
  logs?: RecordDeps
  /** This computer's name, as the runs it handed off say it. */
  host?: string
  now?: () => Date
  log?: (line: string) => void
}

/** One pass over the project's web runs of this computer's. Never throws: what cannot be done now is the next pass's. */
export async function passProject(project: Pick<ProjectRef, 'dir'>, deps: PassDeps = {}): Promise<void> {
  const now = (deps.now ?? (() => new Date()))()
  const here = deps.host ?? hostname()
  const logs = deps.logs ?? {}
  const log = deps.log ?? (() => {})
  const runs = (await projectWebRuns(project, { since: now.getTime() - ADOPTION_WINDOW_MS }, logs)).filter(run => run.card.caller?.['host'] === here)
  if (runs.length === 0) return

  for (const run of runs) {
    if (run.card.status === 'running' && !run.session && !handingOff(run.card.id)) await endUnmade(project.dir, run.card.id, 'failed', logs, () => now)
  }

  // What each run's record gets, one write a run.
  const owed = runs.filter(run => run.anchorRef !== undefined || (run.session !== undefined && (needsBranch(run) || needsPr(run) || run.card.status === 'running')))
  if (owed.length === 0) return
  let account: { git: GitRunner; gh: GhRunner } | undefined
  const asAccount = async (run: WebRun) => (account ??= await (deps.account ?? githubAccount)(project.dir, gitAccountOf(run.card)))
  let fetched: Promise<boolean> | undefined
  for (const run of owed) {
    try {
      const learned: { branch?: string; pr?: { number: number; url: string } } = {}
      if (run.session && run.anchor && (needsBranch(run) || needsPr(run))) {
        const { git, gh } = await asAccount(run)
        fetched ??= git(['fetch', '--prune', 'origin', `+refs/heads/claude/*:${CLOUD_HEADS}*`], project.dir).then(
          () => true,
          () => false,
        )
        if (await fetched) {
          const branch = needsBranch(run) ? await branchOf(git, project.dir, run.anchor) : run.card.branch
          if (branch && needsBranch(run)) learned.branch = branch
          if (branch && !run.card.pr) {
            const pr = await (deps.prOf ?? newestPr)(project.dir, branch, run.card.startedAt, gh).catch((err: unknown) => {
              log(`[host-claude-web] the pull requests of ${branch} could not be read: ${err instanceof Error ? err.message : String(err)}`)
              return undefined
            })
            if (pr) learned.pr = pr
          }
        }
      }
      const pr = learned.pr ?? run.card.pr
      const ends = run.session !== undefined && run.card.status === 'running' && (pr !== undefined || now.getTime() - Date.parse(run.card.startedAt) > SESSION_WINDOW_MS)
      const adopted = (learned.branch ?? run.card.branch)?.startsWith(CLOUD_BRANCHES) === true
      const sweeps = run.anchorRef !== undefined && run.anchor !== undefined && (adopted || now.getTime() - Date.parse(run.card.startedAt) > START_BRANCH_KEPT_MS)
      const swept = sweeps ? await deleteStart((await asAccount(run)).git, project.dir, run.anchorRef!, run.anchor!) : false
      if (!learned.branch && !learned.pr && !ends && !swept) continue
      const at = now.toISOString()
      const more: AnyDiaryLine[] = ends ? [{ kind: 'ended', status: 'done', at }] : []
      await updateWebRun(
        project.dir,
        run.card.id,
        card => {
          const { anchorRef: _swept, ...caller } = card.caller ?? {}
          return { ...card, ...learned, ...(ends ? { status: 'done' as const, endedAt: at } : {}), caller: swept ? caller : { ...card.caller } }
        },
        more,
        logs,
      )
      if (learned.branch) log(`[host-claude-web] web run ${run.card.id}'s session works on ${learned.branch}${learned.pr ? `, its pull request ${learned.pr.url}` : ''}`)
    } catch (err) {
      log(`[host-claude-web] web run ${run.card.id} could not be followed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/** Whether the run's session's branch is still to be found: its record names none of a cloud session's. */
function needsBranch(run: WebRun): boolean {
  return !run.card.branch?.startsWith(CLOUD_BRANCHES)
}

/** Whether the run's session's branch is known and its pull request is not. */
function needsPr(run: WebRun): boolean {
  return !needsBranch(run) && run.card.pr === undefined
}

/** The account the run's start was pushed as: what its branch is read as too. */
function gitAccountOf(card: RunCard): string | undefined {
  const account = card.caller?.['gitAccount']
  return typeof account === 'string' ? account : undefined
}

/** The one `claude/*` branch of origin's that descends from `anchor`; none for none or several. */
async function branchOf(git: GitRunner, dir: string, anchor: string): Promise<string | undefined> {
  const listing = await git(['for-each-ref', `--contains=${anchor}`, '--format=%(refname)', CLOUD_HEADS], dir).catch(() => '')
  const heads = listing
    .split('\n')
    .map(line => line.trim())
    .filter(ref => ref.startsWith(CLOUD_HEADS))
  return heads.length === 1 ? `${CLOUD_BRANCHES}${heads[0]!.slice(CLOUD_HEADS.length)}` : undefined
}

/** The newest pull request of `branch` created since `since`. */
async function newestPr(dir: string, branch: string, since: string, gh: GhRunner): Promise<{ number: number; url: string } | undefined> {
  const prs = await listRequests(dir, { branch, since }, gh)
  const newest = [...prs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return newest ? { number: newest.number, url: newest.url } : undefined
}

/**
 * Delete the run's start's branch from origin while it still is the start, `anchor`. True when it
 * is gone, or is the run's no more (a person pushed to it): the record forgets it either way.
 * False when origin could not be asked: the next pass tries again.
 */
async function deleteStart(git: GitRunner, dir: string, ref: string, anchor: string): Promise<boolean> {
  const deleted = await git(['push', `--force-with-lease=refs/heads/${ref}:${anchor}`, 'origin', `:refs/heads/${ref}`], dir).then(
    () => true,
    () => false,
  )
  if (deleted) return true
  const listed = await git(['ls-remote', 'origin', `refs/heads/${ref}`], dir).catch(() => undefined)
  if (listed === undefined) return false
  const at = listed.trim().split(/\s+/)[0]
  return !at || at !== anchor
}

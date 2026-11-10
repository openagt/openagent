import { readFile, stat } from 'node:fs/promises'
import { listSessionFolders, nodeGitRunner, sessionFolder, sessionsHomeOf, type GitRunner } from '@openagt/agent-data'
import { agentBranchName, reclaimWorktree, worktreeDirEntries, worktreePath } from '@openagt/skill-branches'
import { listRuns, type LogsDeps, type RunCard } from '@openagt/skill-logs'
import { endLiveCard, readLiveCard, readLiveDiary } from './live-card.js'
import { lockHolder, runStderrPath } from './run-lock.js'
import { recordBranchGone, recordRun, runnerMark, startOf } from './records.js'
import { childEndedLine, tellParent, type ParentDeps } from './parent.js'
import { SESSION_FOLDER_STAYS } from './session-folder.js'

/**
 * The belt (#1774): what a run's own process could not do because it died. A scheduler runs it on
 * every tick, before anything is decided, and it acts only for this machine — a pid means nothing on another.
 *
 * A checkout whose live card says `running` under a dead pid is a run that died mid-work: its
 * record is written `failed` from what it left, and the checkout is reclaimed under the branches
 * rule (a dirty tree stays). A checkout whose card says the run ended is one whose process died
 * between the end and the record, or whose checkout held uncommitted work: recorded again, idempotent,
 * and reclaimed again; a run that ended `waiting` keeps its checkout for the answer. A running
 * card on the branch from this machine with no checkout behind it is a run that never started:
 * `failed` with the stderr the spawn left, else `stopped`.
 *
 * A run whose lock a live process holds is that process's: it is booting, working, recording,
 * reclaiming, or resuming, and the sweep does not touch it.
 *
 * A run this sweep ends, one that died mid-work or never started, tells its parent when its record
 * names one (`parent.ts`): its own process is not there to. A run that had ended by itself told
 * its parent then, or died just before it could; the sweep does not tell again.
 *
 * In the sessions home, the runs with no project, a session's folder is where its run worked: it
 * stays, whatever the run's end, and only a folder whose run's record does not say how it ended yet
 * is looked at, so the sweep does not write every session again that ever ran here.
 */

export interface SweepDeps {
  host: string
  isAlive: (pid: number) => boolean
  now?: () => Date
  git?: GitRunner
  logs?: LogsDeps
  log?: (line: string) => void
  /** How an ended parent is continued, in its own process; absent, only a working parent is told. */
  resume?: ParentDeps['resume']
}

export interface SweepResult {
  /** Runs whose record this sweep wrote, and the status it gave them. */
  recorded: { id: string; status: string }[]
  reclaimed: string[]
  kept: { id: string; reason: string }[]
}

export async function sweep(repo: string, deps: SweepDeps): Promise<SweepResult> {
  const git = deps.git ?? nodeGitRunner()
  const now = deps.now ?? (() => new Date())
  const logs = deps.logs ?? {}
  const result: SweepResult = { recorded: [], reclaimed: [], kept: [] }
  const seen = new Set<string>()
  const telling: ParentDeps = { host: deps.host, isAlive: deps.isAlive, ...(deps.resume ? { resume: deps.resume } : {}), log: deps.log ?? (() => {}) }
  const tell = async (card: RunCard, detail: string, branch: string | undefined): Promise<void> => {
    const parent = runnerMark(card)?.parent
    if (parent !== undefined) await tellParent(repo, parent, childEndedLine({ id: card.id, status: card.status, detail, ...(branch !== undefined ? { branch } : {}), ...(card.pr ? { pr: card.pr } : {}) }), telling)
  }

  const sessions = await sessionsHomeOf(repo)
  const recorded = await listRuns(repo, {}, logs)
  const entries = sessions !== undefined ? (await listSessionFolders(sessions)).map(({ id, path }) => ({ agentId: id, path })) : await worktreeDirEntries(repo).catch(() => [])

  // Checkouts first: the live card is the truth about a run this machine started.
  for (const entry of entries) {
    let card = await readLiveCard(entry.path, entry.agentId)
    const mark = card && runnerMark(card)
    if (!card || !mark || mark.host !== deps.host) continue
    seen.add(card.id)
    if (sessions !== undefined && card.status !== 'running' && recorded.some(run => run.id === card!.id && run.status !== 'running')) continue
    if (await lockHolder(repo, card.id, deps.isAlive)) continue
    const died = card.status === 'running'
    if (died) card = await endLiveCard(entry.path, card, 'failed', DIED_DETAIL, now().toISOString())
    const diary = await readLiveDiary(entry.path, card.id)
    const written = await recordRun(repo, card, diary, logs)
    if (written.ok || written.committed) result.recorded.push({ id: card.id, status: card.status })
    if (sessions !== undefined) {
      result.kept.push({ id: card.id, reason: card.status === 'waiting' ? 'waiting' : SESSION_FOLDER_STAYS })
      if (died) await tell(card, DIED_DETAIL, undefined)
      continue
    }
    if (card.status === 'waiting') {
      result.kept.push({ id: card.id, reason: 'waiting' })
      continue
    }
    const reclaimed = await reclaimWorktree(repo, entry.path, { birthBranch: agentBranchName(entry.agentId), ...startOf(card), git })
    if (reclaimed.ok) {
      result.reclaimed.push(card.id)
      await recordBranchGone(repo, card, diary, reclaimed.branchesDeleted, logs)
    } else result.kept.push({ id: card.id, reason: reclaimed.reason })
    if (died) await tell(card, DIED_DETAIL, reclaimed.ok && card.branch !== undefined && reclaimed.branchesDeleted?.includes(card.branch) ? undefined : card.branch)
  }

  // Then the branch: a running card of this machine's with nothing on disk never started.
  for (const card of recorded) {
    if (card.status !== 'running' || seen.has(card.id)) continue
    const mark = runnerMark(card)
    if (!mark || mark.host !== deps.host) continue
    if (await lockHolder(repo, card.id, deps.isAlive)) continue
    if (await checkoutExists(sessions !== undefined ? sessionFolder(sessions, card.id) : worktreePath(repo, card.id))) continue // a checkout with no live card yet: the run is opening it
    // `failed` with the last of the stderr its spawn left, else `stopped`: gone, saying nothing.
    const stderr = (await readFile(runStderrPath(repo, card.id), 'utf8').catch(() => '')).trim()
    const status = stderr ? 'failed' : 'stopped'
    const detail = stderr ? `its process died before the run started: ${stderr.split('\n').slice(-5).join('\n')}` : 'its process is gone and left no checkout'
    const at = now().toISOString()
    const ended: RunCard = { ...card, status, endedAt: at }
    const written = await recordRun(repo, ended, [{ kind: 'ended', status, detail, at }], logs)
    if (written.ok || written.committed) result.recorded.push({ id: card.id, status })
    await tell(ended, detail, undefined)
  }
  return result
}

/** The detail of a run whose process died mid-work. */
const DIED_DETAIL = 'its process died before the run ended'

async function checkoutExists(path: string): Promise<boolean> {
  return stat(path).then(s => s.isDirectory(), () => false)
}

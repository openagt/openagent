import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logDiaryFile, takeInbox } from '@openagt/agent-driver'
import { findRun, type AnyDiaryLine, type RunCard } from '@openagt/skill-logs'
import { defineModule, RunOrder, type RunContext, type RunOutcome } from '@openagt/hooks'
import { legOf, type EarlierLeg, type Leg } from './leg.js'
import { hideLiveDir, inboxPath, liveDir, readLiveCard, readLiveDiary } from './live-card.js'
import { forReaders, recordBranchGone, recordRun } from './records.js'
import { detailOf, effortOf, modelOf, sessionTurns } from './session.js'

/**
 * agent-driver, the module (#2394), as far as the run engine of this package is it: the agent's
 * turns, opening the run's live record first; the record saved from what the session kept, with
 * where the work ended up, as the run's facts say; and the record said again without the branch
 * the reclaim deleted. Its steps work on the leg of the run this process runs (`leg.ts`).
 */
const agentDriver = defineModule({
  name: 'agent-driver',
  hooks: {
    'run.step': [
      { order: RunOrder.RUN, name: 'run the agent', run: runAgent },
      { order: RunOrder.RECORD, name: 'save the record', run: saveRecord },
      { order: RunOrder.CLEANUP + 10, name: 'record the branch gone', run: recordGone },
    ],
  },
})

export default agentDriver

/** How the run ended, as a finishing step reads it: the pipeline says it before the first one. */
function endOf(ctx: RunContext): RunOutcome {
  if (ctx.outcome === undefined) throw new Error(`run ${ctx.id} has not ended`)
  return ctx.outcome
}

/**
 * The session keeps the run's live record itself, the card and the diary under `.openagent/` in
 * the folder the run works in, in the run record's shape; this process adds its mark, the pid and
 * the host. A continued run's diary is written there before the session opens, and goes on from
 * where it stopped.
 */
async function runAgent(ctx: RunContext): Promise<void> {
  const leg = legOf(ctx)
  const workspace = ctx.workspace
  if (workspace === undefined) throw new Error('the run has nowhere to work')
  const branches = ctx.facts['git-branches']
  // Where the run's own work begins, once its checkout says: on its mark for its whole life.
  if (branches?.baseCommit !== undefined) leg.mark = { ...leg.mark, baseCommit: branches.baseCommit }
  leg.card = leg.earlier ? await reopenedCard(leg, workspace, leg.earlier, branches?.again === true) : await freshCard(leg, workspace, branches?.branch)
  const dir = liveDir(workspace)
  if (leg.earlier) {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, logDiaryFile(leg.id)), leg.earlier.diary.map(line => JSON.stringify(line) + '\n').join(''))
  }
  // A checkout with an untracked directory in it is a dirty tree, which the branches rule never reclaims.
  await hideLiveDir(workspace).catch(() => {})
  ctx.outcome = await sessionTurns(leg, workspace, dir, ctx.signal)
}

/**
 * A fresh run's card, which seeds its live record. A run another tool marked carries what only
 * that tool knows, such as a name it gave the run: this process builds its card from its own
 * arguments, which never held it, so without reading the marker back, a run would lose those
 * fields the moment it ends, which is when a person and the tool that started it read them.
 */
async function freshCard(leg: Leg, workspace: string, branch: string | undefined): Promise<RunCard> {
  const { here, mark } = leg
  const marked = leg.marked ? await findRun(leg.repo, leg.id).catch(() => undefined) : undefined
  return carried(marked, {
    id: leg.id,
    startedAt: leg.card.startedAt,
    status: 'running',
    intent: leg.prompt,
    driver: leg.driver.id,
    ...modelOf(leg.model),
    ...effortOf(leg.effort),
    ...(branch !== undefined ? { branch } : {}),
    caller: { runner: mark, pid: here.pid, host: here.host, ...forReaders(mark), kind: 'prompt', workspace },
  })
}

/**
 * This run's card with what only the tool that marked it knew: every field of the marker this
 * process did not build itself, and the same for the writer's own `caller` keys: whatever the tool
 * that marked the run wrote there comes through — the rule a card is read and written by, that a
 * writer keeps the fields it does not know (#2104), applied to a run writing its own record.
 *
 * What this process does know wins: it is running, so its status, its branch, its checkout and its
 * pid are the true ones, and a stale marker never speaks over them.
 */
function carried(marked: RunCard | undefined, card: RunCard): RunCard {
  if (marked === undefined) return card
  const theirs = Object.fromEntries(Object.entries(marked).filter(([key]) => !(key in card)))
  const caller = Object.fromEntries(Object.entries(marked.caller ?? {}).filter(([key]) => !(key in (card.caller ?? {}))))
  return { ...theirs, ...card, ...(Object.keys(caller).length > 0 ? { caller: { ...caller, ...card.caller } } : {}) }
}

/**
 * A continued run's card: its record written running again over the ended one, so every reader
 * sees the run in flight, with this leg's mark. What the leg that ended left in the inbox it did
 * not take is never this leg's to send.
 */
async function reopenedCard(leg: Leg, workspace: string, earlier: EarlierLeg, branchMadeAgain: boolean): Promise<RunCard> {
  const { here, mark } = leg
  await takeInbox(inboxPath(workspace))
  const running: RunCard = { ...leg.card, status: 'running', caller: { ...leg.card.caller, runner: mark, pid: here.pid, host: here.host, ...forReaders(mark), workspace } }
  delete running.endedAt
  // A level taken away by this resume is no longer the run's, for its readers either.
  if (mark.publish === undefined) delete running.caller?.['publish']
  // A record that says its work was landed lost its branch to that. On a branch made again the
  // work is new and not landed: left on the record, every reader would go on saying it is.
  if (branchMadeAgain) delete running.caller?.['landed']
  const reopened = await recordRun(leg.repo, running, earlier.diary, here.logs)
  if (!reopened.ok && !reopened.committed) here.log(`[agent-runner] the run's record could not be written: ${reopened.error}`)
  return running
}

/**
 * The record: the two files the session kept, copied onto the branch unchanged, with where the
 * work ended up, as git-branches and github found it. A session that kept none never started: the
 * card the run had says how it ended, and its diary gets the ended line. The run's own marker
 * lands first.
 */
async function saveRecord(ctx: RunContext): Promise<void> {
  const leg = legOf(ctx)
  const { here, live } = leg
  const end = endOf(ctx)
  // A name asked for as the run began is on its card by now, or never will be.
  leg.named?.stop.abort()
  const branch = ctx.facts['git-branches']?.branch
  const { pr, earlierPrs } = ctx.facts.github ?? {}
  const where = { ...(branch !== undefined ? { branch } : {}), ...(pr ? { pr } : {}) }
  let kept: RunCard | undefined
  let diary: AnyDiaryLine[] | undefined
  if (live && ctx.workspace !== undefined) {
    await live.patch({ ...where, ...(earlierPrs ? { caller: { earlierPrs } } : {}) })
    await live.settled()
    kept = await readLiveCard(ctx.workspace, leg.id)
    diary = await readLiveDiary(ctx.workspace, leg.id)
  }
  const card = kept ?? { ...leg.card, status: end.status, endedAt: here.clock(), ...where, ...(earlierPrs ? { caller: { ...leg.card.caller, earlierPrs } } : {}) }
  const detail = detailOf(end)
  diary ??= [...(leg.earlier?.diary ?? []), { kind: 'ended', status: end.status, ...(detail !== undefined ? { detail } : {}), at: card.endedAt ?? here.clock() }]
  await leg.marking
  const recorded = await recordRun(leg.repo, card, diary, here.logs)
  if (!recorded.ok && !recorded.committed) here.log(`[agent-runner] the run's record could not be written: ${recorded.error}`)
  leg.recorded = { card, diary }
}

/**
 * The record again without its branch when the reclaim deleted that branch: one that held nothing
 * goes with its checkout, and the record must not name a branch that is gone. Written after the
 * reclaim rather than reclaiming first, so the record never says `running` with no checkout behind it.
 */
async function recordGone(ctx: RunContext): Promise<void> {
  const leg = legOf(ctx)
  const reclaimed = ctx.facts['git-branches']?.reclaimed
  if (!leg.recorded || !reclaimed?.reclaimed || !reclaimed.deleted) return
  const rewritten = await recordBranchGone(leg.repo, leg.recorded.card, leg.recorded.diary, reclaimed.deleted, leg.here.logs)
  if (rewritten && !rewritten.ok && !rewritten.committed) leg.here.log(`[agent-runner] the run's record could not be written: ${rewritten.error}`)
}

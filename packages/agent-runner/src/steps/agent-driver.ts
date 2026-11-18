import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logDiaryFile, takeInbox } from '@openagt/agent-driver'
import { findRun, type AnyDiaryLine, type RunCard } from '@openagt/skill-logs'
import { RunOrder, type RunContext, type RunOutcome, type RunStep } from '@openagt/hooks'
import type { EarlierLeg, Leg, Workspace } from '../leg.js'
import { hideLiveDir, inboxPath, liveDir, readLiveCard, readLiveDiary } from '../live-card.js'
import { forReaders, recordBranchGone, recordRun } from '../records.js'
import { detailOf, effortOf, modelOf, sessionTurns } from '../session.js'

/**
 * agent-driver's steps: the agent's turns, opening the run's live record first; the record saved
 * from what the session kept, with where the work ended up; and the record said again without the
 * branch the reclaim deleted.
 */
export function agentDriverSteps(leg: Leg): RunStep[] {
  return [
    { order: RunOrder.RUN, name: 'run the agent', run: ctx => runAgent(leg, ctx) },
    { order: RunOrder.RECORD, name: 'save the record', run: ctx => saveRecord(leg, ctx) },
    { order: RunOrder.CLEANUP + 10, name: 'record the branch gone', run: () => recordGone(leg) },
  ]
}

/** How the run ended, as a finishing step reads it: the pipeline says it before the first one. */
function endOf(ctx: RunContext): RunOutcome {
  if (ctx.outcome === undefined) throw new Error(`run ${ctx.id} has not ended`)
  return ctx.outcome
}

/**
 * The session keeps the run's live record itself, the card and the diary under `.openagent/` in
 * the checkout, in the run record's shape; this process adds its mark, the pid and the host. A
 * continued run's diary is written there before the session opens, and goes on from where it
 * stopped.
 */
async function runAgent(leg: Leg, ctx: RunContext): Promise<void> {
  const checkout = leg.checkout
  if (!checkout) throw new Error('the run has no checkout')
  leg.card = leg.earlier ? await reopenedCard(leg, checkout, leg.earlier) : await freshCard(leg, checkout)
  const dir = liveDir(checkout.path)
  if (leg.earlier) {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, logDiaryFile(leg.id)), leg.earlier.diary.map(line => JSON.stringify(line) + '\n').join(''))
  }
  // A checkout with an untracked directory in it is a dirty tree, which the branches rule never reclaims.
  await hideLiveDir(checkout.path).catch(() => {})
  ctx.outcome = await sessionTurns(leg, checkout, dir, ctx.signal)
}

/**
 * A fresh run's card, which seeds its live record. A run another tool marked carries what only
 * that tool knows, such as a name it gave the run: this process builds its card from its own
 * arguments, which never held it, so without reading the marker back, a run would lose those
 * fields the moment it ends, which is when a person and the tool that started it read them.
 */
async function freshCard(leg: Leg, checkout: Workspace): Promise<RunCard> {
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
    ...(checkout.branch !== undefined ? { branch: checkout.branch } : {}),
    caller: { runner: mark, pid: here.pid, host: here.host, ...forReaders(mark), kind: 'prompt', workspace: checkout.path },
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
async function reopenedCard(leg: Leg, checkout: Workspace, earlier: EarlierLeg): Promise<RunCard> {
  const { here, mark } = leg
  await takeInbox(inboxPath(checkout.path))
  const running: RunCard = { ...leg.card, status: 'running', caller: { ...leg.card.caller, runner: mark, pid: here.pid, host: here.host, ...forReaders(mark), workspace: checkout.path } }
  delete running.endedAt
  // A level taken away by this resume is no longer the run's, for its readers either.
  if (mark.publish === undefined) delete running.caller?.['publish']
  // A record that says its work was landed lost its branch to that. On a branch made again the
  // work is new and not landed: left on the record, every reader would go on saying it is.
  if (checkout.again) delete running.caller?.['landed']
  const reopened = await recordRun(leg.repo, running, earlier.diary, here.logs)
  if (!reopened.ok && !reopened.committed) here.log(`[agent-runner] the run's record could not be written: ${reopened.error}`)
  return running
}

/**
 * The record: the two files the session kept, copied onto the branch unchanged, with where the
 * work ended up. A session that kept none never started: the card the run had says how it ended,
 * and its diary gets the ended line. The run's own marker lands first.
 */
async function saveRecord(leg: Leg, ctx: RunContext): Promise<void> {
  const { here, live, checkout, worked } = leg
  const end = endOf(ctx)
  // A name asked for as the run began is on its card by now, or never will be.
  leg.named?.stop.abort()
  const where = { ...(worked.branch !== undefined ? { branch: worked.branch } : {}), ...(worked.pr ? { pr: worked.pr } : {}) }
  let kept: RunCard | undefined
  let diary: AnyDiaryLine[] | undefined
  if (live && checkout) {
    await live.patch({ ...where, ...(worked.earlierPrs ? { caller: { earlierPrs: worked.earlierPrs } } : {}) })
    await live.settled()
    kept = await readLiveCard(checkout.path, leg.id)
    diary = await readLiveDiary(checkout.path, leg.id)
  }
  const card = kept ?? { ...leg.card, status: end.status, endedAt: here.clock(), ...where, ...(worked.earlierPrs ? { caller: { ...leg.card.caller, earlierPrs: worked.earlierPrs } } : {}) }
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
async function recordGone(leg: Leg): Promise<void> {
  if (!leg.recorded || !leg.deleted) return
  const rewritten = await recordBranchGone(leg.repo, leg.recorded.card, leg.recorded.diary, leg.deleted, leg.here.logs)
  if (rewritten && !rewritten.ok && !rewritten.committed) leg.here.log(`[agent-runner] the run's record could not be written: ${rewritten.error}`)
}

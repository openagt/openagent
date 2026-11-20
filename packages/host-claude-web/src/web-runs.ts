import type { ProjectRef } from '@openagt/hooks'
import { findRun, listRuns, readDiary, writeRun, type AnyDiaryLine, type RecordDeps, type RunCard } from '@openagt/agent-driver'

// A run of this host's, as its record keeps it (#2394): the card says how it stands, and its
// `caller` what only this host knows of it: the cloud session the hand-off made, and the commit and
// the branch the session started from.

/** The host's id: what a run's options and its record name it by (`RunHost.id`). */
export const WEB_HOST = 'web'

/**
 * How long after its start a run's cloud session is followed: the bridge watches it, and the run
 * reads as working, until its session opened a pull request or this passed. Past it nothing could
 * learn the session is still at work, or parked on its person, so "working" would be a guess
 * nobody can correct (#1668).
 */
export const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000

/** A run of this host's, as its record says it. */
export interface WebRun {
  card: RunCard
  /** The cloud session the hand-off made; none until it did. */
  session?: { id: string; url: string }
  /**
   * The commit the session started at (#1601): the project's checkout as it stood at the start,
   * and an empty commit of the run's own on it, so the session's own branch, and only it,
   * descends from it.
   */
  anchor?: string
  /** The branch of origin's the anchor was pushed to, for the session to start on, until the sweep deletes it. */
  anchorRef?: string
}

/** Whether a value reads as a claude.ai session's id, the key the bridge knows a cloud session by: `session_` and letters and digits. */
export function isCloudSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^session_[A-Za-z0-9]{1,128}$/.test(value)
}

/** The address of a cloud session on claude.ai. */
export function sessionUrl(sessionId: string): string {
  return `https://claude.ai/code/${sessionId}`
}

/** The run a card is, when it is one of this host's. */
export function webRunOf(card: RunCard): WebRun | undefined {
  const caller = card.caller ?? {}
  if (caller['target'] !== WEB_HOST) return undefined
  const { sessionId, anchor, anchorRef } = caller
  return {
    card,
    ...(isCloudSessionId(sessionId) ? { session: { id: sessionId, url: sessionUrl(sessionId) } } : {}),
    ...(typeof anchor === 'string' && /^[0-9a-f]{40,64}$/.test(anchor) ? { anchor } : {}),
    ...(typeof anchorRef === 'string' && anchorRef ? { anchorRef } : {}),
  }
}

/** The project's runs of this host's, newest first; none for a project whose records cannot be read. */
export async function projectWebRuns(project: Pick<ProjectRef, 'dir'>, opts: { since?: number } = {}, logs: RecordDeps = {}): Promise<WebRun[]> {
  const cards = await listRuns(project.dir, opts, logs).catch((): RunCard[] => [])
  return cards.flatMap(card => webRunOf(card) ?? []).sort((a, b) => b.card.startedAt.localeCompare(a.card.startedAt))
}

/** The run `id` of the project at `dir`, when it is one of this host's. */
export async function findWebRun(dir: string, id: string, logs: RecordDeps = {}): Promise<WebRun | undefined> {
  const card = await findRun(dir, id, logs).catch(() => undefined)
  return card ? webRunOf(card) : undefined
}

/**
 * Record the run again, its card as `change` makes it and `more` lines after its diary: one write,
 * which reaches wherever the project keeps its records. Nothing is written for a run the project
 * has no record of. Answers the card written.
 */
export async function updateWebRun(dir: string, id: string, change: (card: RunCard) => RunCard, more: readonly AnyDiaryLine[] = [], logs: RecordDeps = {}): Promise<RunCard | undefined> {
  const card = await findRun(dir, id, logs).catch(() => undefined)
  if (!card) return undefined
  const diary = (await readDiary(dir, id, logs).catch(() => undefined)) ?? []
  const next = change(card)
  await writeRun(dir, next, [...diary, ...more], logs)
  return next
}

import type { AgentMeta } from './store/agent-store.js'

// What a Claude web run is doing, read off facts the daemon already holds (#1668).
//
// A web run's local half ends at its hand-off (#1231), so its stored status is `done` from that
// moment on — which said nothing about the session still working on claude.ai, parked on a
// question, or long finished. The rail wrote "in cloud" over every such run, forever. This is the
// one place that turns the record into the word a local run's row would show, and it is node-free
// so the dashboard client, the rail and the Overview all derive the same word from the same rule.

/**
 * How long after its start a run's cloud session is still assumed to be alive. The same window
 * the browser bridge watches a session for (`bridge-sessions`): past it nothing could learn the
 * session is parked, so "in cloud" would be a guess nobody can correct — hence "done".
 */
export const CLOUD_SESSION_WINDOW_MS = 12 * 60 * 60 * 1000

/**
 * What the cloud side of a web run is doing.
 *
 * - `waiting`: the browser bridge holds a question the session is parked on
 * - `merged`: the session's work was adopted (#1601) and its pull request merged by OpenAgent
 * - `in-cloud`: no pull request yet and the run is inside the session window, so it may still be working
 * - `done`: its pull request exists — the work landed, and the PR badge carries its live state — or the
 *   window passed with nothing adopted: the session finished or never pushed
 */
export type CloudRunState = 'waiting' | 'merged' | 'in-cloud' | 'done'

/** The fields of a run's record the projection reads. */
export type CloudRunFacts = Pick<AgentMeta, 'target' | 'status' | 'startedAt' | 'pr' | 'mergeOutcome' | 'cloudWaiting'>

/**
 * The cloud state of a web run whose local half is over, or undefined for any other run — a
 * local run, or a web run still handing off, stopped or failed — whose stored status is the word.
 */
export function cloudRunState(meta: CloudRunFacts, now: number): CloudRunState | undefined {
  if (meta.target !== 'web' || meta.status !== 'done') return undefined
  if (meta.cloudWaiting) return 'waiting'
  if (meta.mergeOutcome === 'merged') return 'merged'
  // A recorded pull request's state is not on the record — it is read live wherever the PR badge
  // shows — so the row says only that the run is over, exactly as a local run with a PR does.
  if (meta.pr) return 'done'
  const started = Date.parse(meta.startedAt)
  return Number.isFinite(started) && now - started <= CLOUD_SESSION_WINDOW_MS ? 'in-cloud' : 'done'
}

/** Whether the cloud side still counts as an agent at work: in its session, or waiting on a human. */
export function cloudRunActive(state: CloudRunState | undefined): boolean {
  return state === 'waiting' || state === 'in-cloud'
}

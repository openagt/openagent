import type { Activity } from './activity.js'
import type { Waiting } from './waiting.js'

/**
 * The stable identity of a watched item, which the browser notifications dedupe on.
 *
 * A leaf module on purpose: `activity.ts` and `waiting.ts` build their items by reading the
 * store, so they import `node:*` and cannot be reached from the browser bundle. These functions
 * are pure and depend on nothing but the item, so they live here and are re-exported from
 * `client.ts` — which is what lets the dashboard share them instead of keeping a copy that could
 * drift from the item types.
 *
 * The type imports are erased at compile time, so they add no edge to the graph `client.test.ts`
 * walks.
 */

/**
 * The stable identity of what waits on the person: its project, the module that says it, and the
 * item's own id among that module's (a pull request's address, a run's question), else what it is
 * about: the project, or the run. A thing said again under the same id is the same row, and is new once.
 */
export function waitingKey(item: Pick<Waiting, 'projectId' | 'module' | 'scope' | 'run' | 'id'>): string {
  return `${item.projectId}:${item.module}:${item.id ?? `${item.scope}:${item.run ?? ''}`}`
}

/**
 * The stable identity of an activity item: its kind + project + run. The kind is part of the key
 * so an agent's `started` and `finished` are two separate announcements (one when it kicks off, one
 * when it lands), each firing exactly once.
 */
export function activityKey(item: Activity): string {
  return `${item.kind}:${item.projectId}:${item.agentId}`
}

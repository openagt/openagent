import type { Activity } from './activity.js'
import type { Intervention } from './interventions.js'

/**
 * The stable identity of a watched item, which the browser notifications dedupe on.
 *
 * A leaf module on purpose: `activity.ts` and `interventions.ts` build their items by reading the
 * store, so they import `node:*` and cannot be reached from the browser bundle. These functions
 * are pure and depend on nothing but the item, so they live here and are re-exported from
 * `client.ts` — which is what lets the dashboard share them instead of keeping a copy that could
 * drift from the item types.
 *
 * The type imports are erased at compile time, so they add no edge to the graph `client.test.ts`
 * walks.
 */

/**
 * The stable identity of an intervention. A PR is its url (survives title edits and re-sorts);
 * the others have no url and are keyed on the project plus the thing waiting — the agent and
 * the gate it is parked on, or the agent whose work is uncommitted or unpushed.
 *
 * The agent is part of the awaiting key because a gate id is only unique within its own agent:
 * every agent's first gate is `await-choices`. Two agents running in one project (#736) and both
 * parked would otherwise share one identity, and the dedupe would announce only one of them.
 */
export function interventionKey(item: Intervention): string {
  if (item.kind === 'awaiting') return `awaiting:${item.projectId}:${item.agentId ?? ''}:${item.awaitId ?? ''}`
  if (item.kind === 'uncommitted' || item.kind === 'unpushed') return `${item.kind}:${item.projectId}:${item.agentId ?? ''}`
  return item.url ?? ''
}

/**
 * The stable identity of an activity item: its kind + project + run. The kind is part of the key
 * so an agent's `started` and `finished` are two separate announcements (one when it kicks off, one
 * when it lands), each firing exactly once.
 */
export function activityKey(item: Activity): string {
  return `${item.kind}:${item.projectId}:${item.agentId}`
}

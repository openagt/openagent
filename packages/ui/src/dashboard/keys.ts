import type { Waiting } from './waiting.js'

/**
 * The stable identity of what waits on the person, which the lists key their rows on and the
 * browser notifications dedupe on.
 *
 * A leaf module on purpose: `waiting.ts` builds its items by reading the store, so it imports
 * `node:*` and cannot be reached from the browser bundle. This function is pure and depends on
 * nothing but the item, so it lives here and is re-exported from `client.ts` — which is what lets
 * the dashboard and its plugins share it instead of keeping a copy that could drift from the item type.
 *
 * The type import is erased at compile time, so it adds no edge to the graph `client.test.ts` walks.
 */

/**
 * The stable identity of what waits on the person: its project, the module that says it, and the
 * item's own id among that module's (a pull request's address, a run's question), else what it is
 * about: the project, or the run. A thing said again under the same id is the same row, and is new once.
 */
export function waitingKey(item: Pick<Waiting, 'projectId' | 'module' | 'scope' | 'run' | 'id'>): string {
  return `${item.projectId}:${item.module}:${item.id ?? `${item.scope}:${item.run ?? ''}`}`
}

import { AsyncLocalStorage } from 'node:async_hooks'
import type { TeamCaller } from '@openagt/hooks'

// Who a request is for, in Team mode (team-gate.ts), all the way down what it calls: the door
// sets it once, and a module's function, or a run it starts, reads it here, with no argument
// threaded through every call between. None on a machine of one person.

const callers = new AsyncLocalStorage<TeamCaller | undefined>()

/** Run `fn` as `caller`'s: everything it calls, now or later, sees them. */
export function asCaller<T>(caller: TeamCaller | undefined, fn: () => T): T {
  return callers.run(caller, fn)
}

/** Who the request at work is for; none outside one, or on a machine of one person. */
export function currentCaller(): TeamCaller | undefined {
  return callers.getStore()
}

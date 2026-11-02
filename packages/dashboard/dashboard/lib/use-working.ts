import type { ActiveAgent, Overview } from '../../src/index.js'
import { onOverview } from '../rpc/reads.js'
import { usePolled } from './use-async.js'
import { runsAgain, useRunsPace } from './runs-changed.js'

// Is an agent working right now (#875)? Cross-project on purpose: the mark answers "is the AI
// working for you", which is not "is it working on the project you happen to have selected" —
// an agent left going in another project still means it is working for you.
//
// `onOverview` is the read that answers this (#437, `active` = every running agent across the
// registry). The shell reads it once for the mark, the tab icon and the Overview's "Working now"
// and "Agents at work": one small read, where the Overview used to poll `onDashboard`, which
// builds every project's queue and tickets too, beside it.

/** Stable initial, so the poll does not churn on every render. */
const IDLE: Overview = { active: [], queueOpen: 0, recent: [] }

/** Every agent going right now, across the projects; `stale` while that is only what an earlier visit read. */
export function useActiveAgents(): { active: ActiveAgent[]; stale: boolean } {
  const { value, stale } = usePolled<Overview>(onOverview, IDLE, useRunsPace(5000), [], { remember: 'overview', stored: true }, runsAgain(undefined))
  return { active: value.active, stale }
}

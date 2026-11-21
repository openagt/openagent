/**
 * How long a run just started counts as starting: its host answered its id, and the run is still
 * making its checkout, so no card names its process yet. The page reads it often for that
 * long; this computer's host waits as long for the process when a Stop is pressed in it
 * (agent-driver's `engine/host.ts`). Pure, for the page's bundle.
 */
export const STARTING_AT_MOST_MS = 30_000

/**
 * How long a run just started counts as starting: its start line answered its id, and its tool is
 * still making its checkout, so no card names its process yet. The page reads it often for that
 * long, and a Stop pressed in it waits that long for the process to stop. Pure, for both sides.
 */
export const STARTING_AT_MOST_MS = 30_000

// The one color vocabulary for an agent's status, shared by every list that shows one
// (the Runs rail, the project log) so the same status can never read as two colors.
export const STATUS_TONE: Record<string, string> = {
  running: 'text-primary',
  done: 'text-success',
  stopped: 'text-warning',
  failed: 'text-danger',
}

/**
 * The same vocabulary as a circle, for the lists that show a status as a dot rather than a word
 * (the sessions on the rail): filled while something is going on, a ring once nothing is.
 */
export const STATUS_DOT: Record<string, string> = {
  running: 'bg-primary',
  waiting: 'bg-warning',
  saving: 'bg-success',
  failed: 'bg-danger',
}

export const STATUS_RING: Record<string, string> = {
  stopped: 'border-warning/70',
  merged: 'border-success/70',
  done: 'border-muted-foreground/60',
}

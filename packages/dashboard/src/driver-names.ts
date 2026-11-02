/**
 * The driver vocabulary (#542), node-free so every surface shares one copy: the registry's
 * preference sanitizer and the dashboard bundle. The names are agent-driver's own, the ones a
 * run's card carries, so the pick handed to a project's start hook as `DRIVER` and the record
 * that comes back say the same word. The dashboard's per-driver UI table is keyed by
 * {@link DriverName}, so a missing entry there is a compile error, not a silent gap.
 */

/** The coding agents a person can pick for a run, in the order surfaces list them. */
export const DRIVERS = ['claude-code', 'codex'] as const

/** A driver the user can pick. */
export type DriverName = (typeof DRIVERS)[number]

/** Whether `value` names a driver we can run. */
export function isDriverName(value: string | undefined): value is DriverName {
  return value !== undefined && (DRIVERS as readonly string[]).includes(value)
}

/** How each driver reads in a sentence or on a button. */
export const DRIVER_LABELS: Record<DriverName, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
}

/**
 * The pick behind the driver a run's record names (#831). Every surface Claude ran on is still
 * Claude (#1263): older records name its cloud session and its Actions runner. `undefined` for a
 * driver no pick claims (a fake one, or a record from a newer version).
 */
export function driverFromImpl(impl: string | undefined): DriverName | undefined {
  if (impl === 'claude-web' || impl === 'github-actions') return 'claude-code'
  return isDriverName(impl) ? impl : undefined
}

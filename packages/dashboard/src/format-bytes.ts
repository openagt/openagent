// A size for a label, not a report: two significant-ish digits and a unit, so "how much would
// removing this give me back" is answerable at a glance (#798).

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** `1536` → `1.5 KB`. Absent, negative, or unparseable reads as an en dash, like a missing date. */
export function formatBytes(bytes: number | undefined, fallback = '–'): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return fallback
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  // Whole numbers above 10 read better without a decimal: `512 MB`, not `512.0 MB`.
  const rounded = value < 10 && unit > 0 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${rounded} ${UNITS[unit]}`
}

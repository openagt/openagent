// A ticket's `Priority:` key is a `0`-`10` scale (#1144/#1265): 10 acts immediately, 0 only if
// there is capacity. Shared here so the list row, the detail page, and the sort dropdown read the
// scale the same way rather than three ad hoc parses drifting apart.

/** The priority as a number, or `undefined` when the ticket names none or it does not parse. */
export function parsePriority(priority: string | undefined): number | undefined {
  if (priority === undefined) return undefined
  const n = Number.parseInt(priority, 10)
  return Number.isNaN(n) ? undefined : n
}

/** How a priority reads: a critical one (8 and up, the filter's "Critical") red, every other in the text's colour. */
export function priorityTone(priority: string | undefined): string {
  return (parsePriority(priority) ?? 0) >= 8 ? 'text-danger' : 'text-foreground'
}

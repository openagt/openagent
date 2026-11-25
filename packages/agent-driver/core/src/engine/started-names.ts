// The names this computer's host asked for as it started runs (`ReadyNaming`), kept by run id for
// the few seconds before the run's own record has its name.
//
// A name is ready about a second after Start, and the run's row is in the list only once its agent
// has started, a second or two later; its record has the name later still, once the run took it
// from the file it was handed. So this computer's host lists the run with the name asked here until
// the record has its own, and as being named while the ask goes on (`withStartedNames`).

/** How long a name is kept: past the start of any run, and past any wait for one. */
const KEPT_MS = 2 * 60_000

interface Started {
  name: Promise<string | undefined>
  title?: string
  /** The ask ended, with a name or without one. */
  settled?: true
  until: number
}

const started = new Map<string, Started>()

/** Keep the name being asked for the run `id`. */
export function nameStarted(id: string, name: Promise<string | undefined>, now = Date.now()): void {
  for (const [kept, one] of started) if (one.until < now) started.delete(kept)
  const one: Started = { name, until: now + KEPT_MS }
  started.set(id, one)
  void name.then(
    title => {
      if (title !== undefined) one.title = title
      one.settled = true
    },
    () => (one.settled = true),
  )
}

/**
 * The rows with the name asked for at their start, on each row whose record has none of its own
 * yet; a row whose name is still being asked for is being named.
 */
export function withStartedNames<T extends { id: string; title?: string | undefined; naming?: true }>(rows: T[], now = Date.now()): T[] {
  if (started.size === 0) return rows
  return rows.map(row => {
    const one = row.title === undefined ? started.get(row.id) : undefined
    if (one === undefined || one.until < now) return row
    if (one.title !== undefined) {
      const { naming: _named, ...named } = row
      return { ...named, title: one.title } as T
    }
    return one.settled ? row : { ...row, naming: true }
  })
}

/** Forget every name: for tests. */
export function forgetStartedNames(): void {
  started.clear()
}

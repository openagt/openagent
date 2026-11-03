import type { AgentMeta } from './store/index.js'

// The names this daemon asked for as it started runs (`ReadyNaming` in agent-runner), kept by run
// id for the few seconds before the run's own record has its name.
//
// A name is ready about a second after Start, and the run's row is in the list only once its agent
// has started, a second or two later; its record has the name later still, once the run took it
// from the file it was handed. So the page asks here for a run it just started (`onStartedName`),
// and the list shows the name on the run's row until the record has its own.

/** How long a name is kept: past the start of any run, and past any wait for one. */
const KEPT_MS = 2 * 60_000

interface Started {
  name: Promise<string | undefined>
  title?: string
  until: number
}

const started = new Map<string, Started>()

/** Keep the name being asked for the run `id`. */
export function nameStarted(id: string, name: Promise<string | undefined>, now = Date.now()): void {
  for (const [kept, one] of started) if (one.until < now) started.delete(kept)
  const one: Started = { name, until: now + KEPT_MS }
  started.set(id, one)
  void name.then(title => {
    if (title !== undefined) one.title = title
  })
}

/** The name asked for the run `id`, once it is in; nothing for a run not started here, or none came. */
export async function startedName(id: string): Promise<string | undefined> {
  return started.get(id)?.name.catch(() => undefined)
}

/** The rows with the name asked for at their start, on each row whose record has none of its own yet. */
export function withStartedNames(rows: AgentMeta[], now = Date.now()): AgentMeta[] {
  if (started.size === 0) return rows
  return rows.map(row => {
    const one = row.title === undefined ? started.get(row.id) : undefined
    return one?.title !== undefined && one.until >= now ? { ...row, title: one.title } : row
  })
}

/** Forget every name: for tests. */
export function forgetStartedNames(): void {
  started.clear()
}

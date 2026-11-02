/**
 * The shape every one of the daemon's background passes over the registered projects has (E4):
 * no timer of its own, one turn per `tick()` call from the daemon's single clock, and a `stop()`
 * that takes effect between projects.
 *
 * Two services walk the projects this way — the cloud scratch-ref sweep (#1547) and cloud work
 * adoption (#1601). They differ only in what they do to one project; the walking, the overlap
 * rule and the stop flag are written out once here.
 */

/** A running background pass, in the shape the daemon's services are wired as. */
export interface ProjectPass {
  /** Run one pass now, awaiting it. Exposed for tests and for a caller that wants it on demand. */
  tick: () => Promise<void>
  stop: () => void
}

/** The registered projects a pass walks, as the daemon hands them over. */
export type ProjectsSource = () => Promise<readonly { path: string }[]>

/**
 * Walk every registered project once per `tick()`, calling `visit` with each project's path.
 *
 * Overlapping ticks join the pass already running rather than being dropped: awaiting `tick()`
 * has to mean the pass finished, or an on-demand caller (and a test) gets a silent no-op whenever
 * the clock's turn happens to be mid-flight. A stopped pass ticks as a no-op, and a `stop()`
 * during a pass takes effect before the next project rather than mid-project.
 *
 * A `projects()` that rejects yields nothing to walk: a registry that cannot be read is this
 * turn's problem, not the daemon's, and the next tick tries again.
 */
export function startProjectPass(projects: ProjectsSource, visit: (cwd: string) => Promise<void>): ProjectPass {
  let stopped = false
  let inflight: Promise<void> | undefined

  const passAll = async (): Promise<void> => {
    for (const project of await projects().catch(() => [])) {
      if (stopped) break
      await visit(project.path)
    }
  }

  return {
    tick: () => {
      if (stopped) return Promise.resolve()
      inflight ??= passAll().finally(() => {
        inflight = undefined
      })
      return inflight
    },
    stop: () => {
      stopped = true
    },
  }
}

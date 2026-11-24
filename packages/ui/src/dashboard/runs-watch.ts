import { basename } from 'node:path'
import { metaOf, type AgentMeta } from '../store/index.js'
import { contextHost } from '../dashboard-rpc/context.js'

/**
 * Who is told at once when this computer's runs of a project change: a page that lists them
 * (`/_rpc/changes`). Nothing tells OpenAgent when a run changes: a run's process writes it as it
 * goes. So while someone listens, this computer's host is asked for the project's runs every
 * second, and they are compared by what a list shows of a run; at once when a run was just
 * started here ({@link RunsWatch.poke}). Nobody listening, nothing is read.
 */

/** Where a project's runs are read, by its folder. */
export interface RunsWatchSource {
  runs(cwd: string): Promise<readonly AgentMeta[]>
}

/** How often the runs are read while someone listens. */
const LOOK_EVERY_MS = 1_000
/**
 * How long a project is still read after its last listener left: a page that reloads listens again
 * at once, and finds what was last read of it.
 */
const LINGER_MS = 30_000

/**
 * What a list shows of a run, as one string to compare: what it is, how it stands, and its name or its wait for one.
 * A run's card is written at every step it takes, with a later time and a higher cost, and none
 * of that is a change a person waits on.
 */
function shownOf(run: AgentMeta): string {
  return JSON.stringify([run.id, run.status, run.title, run.naming, run.branch, run.pr?.number, run.endedAt])
}

/** One project's watch, while someone listens. */
interface Watched {
  listeners: Set<() => void>
  /** Until when it is read with nobody listening. */
  lingers: number
  /** What a list showed of the runs at the last look; none before the first. */
  shown?: string
  timer?: ReturnType<typeof setTimeout>
  looking: boolean
}

export class RunsWatch {
  private readonly watched = new Map<string, Watched>()

  constructor(
    private readonly source: RunsWatchSource,
    private readonly now: () => number = Date.now,
    private readonly everyMs = LOOK_EVERY_MS,
  ) {}

  /** Tell `changed` each time the project's runs here change, until the answer is called. */
  follow(cwd: string, changed: () => void): () => void {
    let watched = this.watched.get(cwd)
    if (!watched) {
      this.watched.set(cwd, (watched = { listeners: new Set(), lingers: 0, looking: false }))
      this.lookIn(watched, cwd, 0)
    }
    // Its own entry, so one listener given twice is told twice and stopped once each.
    const listener = (): void => changed()
    const held = watched
    held.listeners.add(listener)
    return () => {
      held.listeners.delete(listener)
      if (held.listeners.size === 0) held.lingers = this.now() + LINGER_MS
    }
  }

  /** A run of the project was just started here: its runs are read again now. */
  poke(cwd: string): void {
    const watched = this.watched.get(cwd)
    if (watched && !watched.looking) this.lookIn(watched, cwd, 0)
  }

  private lookIn(watched: Watched, cwd: string, ms: number): void {
    clearTimeout(watched.timer)
    watched.timer = setTimeout(() => void this.look(cwd, watched), ms)
    watched.timer.unref?.()
  }

  private async look(cwd: string, watched: Watched): Promise<void> {
    if (watched.listeners.size === 0 && this.now() >= watched.lingers) {
      this.watched.delete(cwd)
      return
    }
    watched.looking = true
    try {
      const runs = await this.source.runs(cwd).catch(() => undefined)
      if (runs === undefined) return
      const shown = runs.map(shownOf).join('\n')
      const before = watched.shown
      watched.shown = shown
      if (before !== undefined && before !== shown) for (const listener of [...watched.listeners]) listener()
    } finally {
      watched.looking = false
      this.lookIn(watched, cwd, this.everyMs)
    }
  }
}

/** This computer's own runs, watched for whoever listens: its host is asked of the folder's runs (a project's, or the sessions home's). */
export const ownRunsWatch = new RunsWatch({
  runs: async cwd => {
    const host = contextHost()
    return (await host.list({ id: basename(cwd), name: basename(cwd), dir: cwd })).map(run => metaOf(run, host.id))
  },
})

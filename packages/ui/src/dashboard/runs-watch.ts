import { projectBranches, readLiveMeta, type AgentMeta, type Checkout } from '../store/index.js'
import { shownOf } from './machine-runs.js'

/**
 * Who is told at once when this computer's runs of a project change: another computer that waits
 * for them (machine-runs.ts), and a page that lists them (`/_rpc/changes`). Nothing tells
 * OpenAgent when a run changes: a run's tool writes its card in the run's checkout. So while
 * someone listens, the cards are read every second and compared by what a list shows of a run;
 * the checkouts themselves are listed again less often, since that runs the branches provider,
 * and at once when a run was just started here ({@link RunsWatch.poke}). Nobody listening,
 * nothing is read.
 */

/** Where a project's runs with a checkout are read: its checkouts, and each one's card. */
export interface RunsWatchSource {
  /** `fresh`: a checkout may have just come, and a list read a moment ago does not hold it. */
  checkouts(cwd: string, fresh: boolean): Promise<readonly Checkout[]>
  card(checkout: Checkout): Promise<AgentMeta | undefined>
}

/** How often the cards are read while someone listens. */
const LOOK_EVERY_MS = 1_000
/** How often the checkouts are listed again while someone listens: a run started elsewhere than this OpenAgent shows within it. */
const LIST_EVERY_MS = 15_000
/**
 * How long the checkouts are listed at every look after a run was started here: the start answers
 * before the run's checkout is there, and a run that ends within seconds is gone by the next list.
 */
const POKED_MS = 10_000
/**
 * How long a project is still read after its last listener left: a computer that waits for the
 * runs asks again the moment it was answered, and its checkouts are not listed again for that.
 */
const LINGER_MS = 30_000

/** One project's watch, while someone listens. */
interface Watched {
  listeners: Set<() => void>
  /** Until when it is read with nobody listening. */
  lingers: number
  checkouts?: readonly Checkout[]
  /** When the checkouts were listed. */
  listedAt: number
  /** Until when they are listed at every look: a run was just started here. */
  poked: number
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
      this.watched.set(cwd, (watched = { listeners: new Set(), lingers: 0, listedAt: 0, poked: 0, looking: false }))
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

  /** A run of the project was just started here: its checkouts are listed again at every look for a while, from now. */
  poke(cwd: string): void {
    const watched = this.watched.get(cwd)
    if (!watched) return
    watched.poked = this.now() + POKED_MS
    if (!watched.looking) this.lookIn(watched, cwd, 0)
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
      const poked = this.now() < watched.poked
      if (watched.checkouts === undefined || poked || this.now() - watched.listedAt >= LIST_EVERY_MS) {
        watched.listedAt = this.now()
        watched.checkouts = await this.source.checkouts(cwd, poked).catch(() => watched.checkouts ?? [])
      }
      const cards = await Promise.all(watched.checkouts.map(checkout => this.source.card(checkout).catch(() => undefined)))
      const shown = cards.flatMap(card => (card ? [shownOf(card)] : [])).join('\n')
      const before = watched.shown
      watched.shown = shown
      if (before !== undefined && before !== shown) for (const listener of [...watched.listeners]) listener()
    } finally {
      watched.looking = false
      this.lookIn(watched, cwd, this.everyMs)
    }
  }
}

/** This computer's own runs, watched for whoever listens. */
export const ownRunsWatch = new RunsWatch({
  checkouts: async (cwd, fresh) => (await (await projectBranches(cwd))?.list({ fresh })) ?? [],
  card: checkout => readLiveMeta(checkout),
})

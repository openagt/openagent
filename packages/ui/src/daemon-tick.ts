import { errorMessage } from './error-message.js'

/**
 * The daemon's one background clock (E4).
 *
 * Every sweep used to own a timer: one `setInterval`, one unref call and one overlap guard
 * each, and no single place to look when the answer to "why is nothing happening" is that a
 * sweep is not running.
 *
 * One interval fires, and each job says how often it wants a turn. A job's cadence stops being a
 * duration it has to reason about and becomes a small integer: how many ticks between turns.
 *
 * The base interval is the finest cadence anything needs. Anything slower is that many ticks —
 * exact by construction, because the ratios are integers rather than two timers drifting apart.
 */

/** One thing the daemon does on a schedule. */
export interface TickJob {
  /** For the log line when it throws. */
  name: string
  /**
   * Ticks between turns. `1` is every tick, `20` is every twentieth. A tick is the interval
   * coming round, not a turn that ran, so a slow job on the same clock cannot stretch this out.
   *
   * Its own turn is *skipped* rather than queued, so a slow job never accumulates a backlog of
   * missed turns to work through.
   */
  every?: number
  /** Run one turn. Awaited, so a long job holds the tick rather than overlapping the next one. */
  run: () => Promise<void>
  /**
   * Run on the very first tick, which fires at start-up rather than one interval later.
   *
   * On by default, because the case most of these exist for is a machine that was off while
   * something happened. A job that only makes sense once the daemon has been up a while says so.
   */
  onStart?: boolean
}

/** The running clock. */
export interface DaemonTick {
  /** Run one tick now, awaiting it. The tests drive the clock through this. */
  tick: () => Promise<void>
  /**
   * Stop the clock, and resolve when the turn already in flight has finished. Awaiting it is how
   * a shutdown knows the sweeps have let go of the repo — clearing the interval only stops the
   * *next* turn, and these jobs commit and push.
   */
  stop: () => Promise<void>
}

/** How often the clock fires. The finest cadence any job asks for; everything else is a multiple. */
export const DAEMON_TICK_MS = 30_000

/** What {@link startDaemonTick} needs. */
export interface DaemonTickOptions {
  jobs: readonly TickJob[]
  /** Override the base interval (tests). */
  intervalMs?: number
  log: (message: string) => void
}

/** Ticks between a job's turns, defaulted and floored. */
function cadence(job: TickJob): number {
  return Math.max(1, job.every ?? 1)
}

/**
 * Start the clock and return the handle that stops it.
 *
 * A job that throws costs its own turn and nothing else: the others in the same tick still run,
 * and the failure is logged once with the job's name, because a sweep failing silently is
 * indistinguishable from one that is not scheduled at all.
 *
 * Overlapping ticks join the one already running rather than being dropped, so awaiting `tick()`
 * means the tick finished — which is what lets a test drive this deterministically. The timer is
 * unref'd: background work is never the reason the process stays up.
 */
export function startDaemonTick(opts: DaemonTickOptions): DaemonTick {
  let stopped = false
  /**
   * Which tick is running now. Advanced by {@link elapsedWhileBusy} as well as by one, so it
   * stays a count of how many times the interval has *come round* rather than how many turns
   * happened to run (#1607).
   */
  let tickNow = -1
  /**
   * Interval firings that arrived while a turn was in flight. Time passed for them, so they count
   * towards every cadence — the turn they would each have had is folded into the next one.
   */
  let elapsedWhileBusy = 0
  let inflight: Promise<void> | undefined
  /**
   * The tick each job last took a turn on, seeded so tick 0 is already due for a job that wants
   * the start-up turn and one whole cadence away for a job that sits it out.
   */
  const lastTurn = opts.jobs.map(job => (job.onStart === false ? 0 : -cadence(job)))

  const runTick = async (n: number): Promise<void> => {
    for (const [index, job] of opts.jobs.entries()) {
      if (stopped) return
      // Ticks *since this job's own last turn*, rather than `n % every`: when the clock jumps
      // over the tick a job's cadence would have landed on, the job is due at the next turn
      // instead of waiting a whole further cadence for the modulo to come round again.
      if (n - lastTurn[index]! < cadence(job)) continue
      // Claimed before the run, not after: a missed turn is skipped rather than queued, and a job
      // that throws has still had its turn.
      lastTurn[index] = n
      try {
        await job.run()
      } catch (err) {
        opts.log(`[openagent] ${job.name} failed this tick: ${errorMessage(err)}`)
      }
    }
  }

  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    // A caller that arrives mid-turn joins it without moving the clock: `tick()` means "run a
    // turn now" — the daemon's shutdown and the tests drive it, and neither is elapsed time.
    // Only the interval is, and it says so through `elapsedWhileBusy`.
    if (inflight) return inflight
    tickNow += 1 + elapsedWhileBusy
    elapsedWhileBusy = 0
    inflight = runTick(tickNow).finally(() => {
      inflight = undefined
    })
    return inflight
  }

  void tick()
  const timer = setInterval(() => {
    // The clock moved whether or not a turn can start. Counting a firing that lands on a busy
    // daemon is the whole point: without it a long job — a data sync failing slowly against an
    // unreachable remote — stretched every `every: N` cadence by its own duration, because a
    // cadence was measured in turns that ran rather than in time that passed (#1607).
    if (inflight) {
      elapsedWhileBusy++
      return
    }
    void tick()
  }, opts.intervalMs ?? DAEMON_TICK_MS)
  timer.unref?.()
  return {
    tick,
    stop: async () => {
      stopped = true
      clearInterval(timer)
      // The turn in flight stops at the next job boundary, but the job it is inside runs to the
      // end — so wait it out rather than leaving a sweep mid-commit.
      await inflight?.catch(() => {})
    },
  }
}

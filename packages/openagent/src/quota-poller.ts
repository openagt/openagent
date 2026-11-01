import { isTransientQuotaReason, type DriverQuota, type DriverQuotaUnavailableReason } from '@openagt/agent-driver'

/**
 * How often to read the quota when everything is healthy. A read spawns the
 * whole agent CLI (~5s), and the agent's own usage fetch is refused upstream if
 * asked too often, so this is deliberately slow: the boundary moves over days,
 * which a 5-minute sample rate resolves comfortably.
 */
export const DEFAULT_POLL_MS = 5 * 60 * 1000

/** Longest gap between reads once backoff has stretched it. */
export const MAX_POLL_MS = 30 * 60 * 1000

/**
 * What the poller currently believes about the account's quota.
 *
 * `latest` is the last attempt as it came back; `lastGood` is the last real
 * reading. The two are separate so a transient blip doesn't blank a number that
 * was accurate a minute ago — a bar going empty reads as "nothing used", which
 * is the one thing this feature must never imply.
 */
export interface QuotaEnvelope {
  /** The most recent attempt, exactly as it came back. `undefined` before the first. */
  latest: DriverQuota | undefined
  /** The most recent successful reading, retained across transient failures. */
  lastGood: (DriverQuota & { available: true }) | undefined
  /** When {@link lastGood} was read, epoch ms. */
  lastGoodAt: number | undefined
  /** When the last failure happened, epoch ms. */
  lastFailureAt: number | undefined
}

/** Options for {@link QuotaPoller}. */
export interface QuotaPollerOptions {
  /** Read the quota once. Normally `driver.readQuota`. */
  read: () => Promise<DriverQuota>
  /** Healthy interval. Default {@link DEFAULT_POLL_MS}. */
  intervalMs?: number
  /** Ceiling for the backed-off interval. Default {@link MAX_POLL_MS}. */
  maxIntervalMs?: number
  /** Clock, injectable for tests. */
  now?: () => number
}

/**
 * Keeps a recent quota reading on hand (#525).
 *
 * Polling is slow by design and backs *off* on failure rather than retrying
 * into it: the agent's usage fetch is refused upstream when asked too often,
 * and the penalty window is minutes long, so an eager retry loop would keep the
 * number permanently unavailable — the opposite of the goal.
 */
export class QuotaPoller {
  private envelope: QuotaEnvelope = { latest: undefined, lastGood: undefined, lastGoodAt: undefined, lastFailureAt: undefined }
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private currentIntervalMs: number
  private stopped = false
  private readonly now: () => number

  constructor(private readonly opts: QuotaPollerOptions) {
    this.currentIntervalMs = opts.intervalMs ?? DEFAULT_POLL_MS
    this.now = opts.now ?? (() => Date.now())
  }

  /** What we currently believe. */
  current(): QuotaEnvelope {
    return { ...this.envelope }
  }

  /** The gap before the next read, which grows while the fetch keeps being refused. */
  get intervalMs(): number {
    return this.currentIntervalMs
  }

  /** Whether {@link stop} ended the polling. */
  get isStopped(): boolean {
    return this.stopped
  }

  /**
   * Read once, now, and fold the result in. Safe to call on demand (e.g. right
   * after a turn settles) alongside the timer.
   */
  async poll(): Promise<DriverQuota> {
    let quota: DriverQuota
    try {
      quota = await this.opts.read()
    } catch {
      // A driver that throws is the same story as one that reports a failed
      // fetch: this attempt told us nothing, and it may work next time.
      quota = { available: false, reason: 'fetch-failed' }
    }
    this.envelope = { ...this.envelope, latest: quota }
    if (quota.available) {
      this.onGood(quota)
    } else {
      this.onBad(quota.reason)
    }
    return quota
  }

  /**
   * Begin polling, starting with a read right now rather than one interval from
   * now: a poller whose first reading lands five minutes in is no use to an agent
   * that just started, and the session's own measurement needs a baseline. Not
   * awaited — the read takes ~5s and nothing should wait on it. Idempotent.
   */
  start(): void {
    if (this.running || this.stopped) return
    this.running = true
    void this.poll().finally(() => this.schedule())
  }

  /** Stop polling. Idempotent. */
  stop(): void {
    this.stopped = true
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private onGood(quota: DriverQuota & { available: true }): void {
    this.envelope = { ...this.envelope, lastGood: quota, lastGoodAt: this.now() }
    // Reset the backoff: the fetch is working again.
    this.currentIntervalMs = this.opts.intervalMs ?? DEFAULT_POLL_MS
  }

  private onBad(reason: DriverQuotaUnavailableReason): void {
    this.envelope = { ...this.envelope, lastFailureAt: this.now() }
    // No subscription, or no agent: the kept reading would misrepresent the account now. Either can
    // change while the daemon lives (a login, an update swapping the CLI), so it is asked again too.
    if (!isTransientQuotaReason(reason)) this.envelope = { ...this.envelope, lastGood: undefined, lastGoodAt: undefined }
    // Ask again later, later than last time.
    this.currentIntervalMs = Math.min(this.currentIntervalMs * 2, this.opts.maxIntervalMs ?? MAX_POLL_MS)
  }

  private schedule(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      void this.poll().finally(() => {
        this.timer = undefined
        this.schedule()
      })
    }, this.currentIntervalMs)
    // Don't hold the process open just to read a quota; the daemon's own work
    // decides its lifetime. Unlike the read's timeout, nothing awaits this.
    this.timer.unref?.()
  }
}

import { QuotaPoller } from '../quota-poller.js'
import { weekBoundary, type QuotaBoundary } from '../quota-boundary.js'
import { ClaudeCodeDriver } from '@openagt/agent-driver-claude'
import { keepClaudeReading } from '@openagt/skill-account-rotation'
import type { DriverQuotaUnavailableReason, DriverQuotaWindow } from '@openagt/agent-driver'

/**
 * Everything the dashboard needs to draw the usage panel (#533): the account's
 * own windows, and where they stand against the quota boundary (#879).
 */
export interface QuotaView {
  /**
   * The account's quota windows as the agent reported them (session, week, and
   * a week per model). Empty when we have no reading at all — check
   * {@link unavailable} before reading that as "nothing used".
   */
  windows: DriverQuotaWindow[]
  /** When the reading was taken, epoch ms. Absent when there has never been one. */
  readAt?: number
  /**
   * Why there is no reading, when there isn't one. Present alongside stale
   * `windows` too: the last good reading is kept through a blip, and this says
   * the newest attempt failed, so the UI can mark it stale rather than blank it.
   */
  unavailable?: DriverQuotaUnavailableReason
  /**
   * The quota boundary of the account's week (#879). Absent when there is no
   * reading, or when the week's reset could not be placed — which is "we don't
   * know", not "nothing is allowed".
   */
  boundary?: QuotaBoundary
}

/** Where a dashboard reads the quota from. */
export interface QuotaSource {
  read(): Promise<QuotaView>
  /** Stop any polling behind it. */
  stop(): void
}

/**
 * A {@link QuotaSource} backed by a live poller.
 *
 * The boundary is measured per read rather than captured: it moves with the clock, so a cached
 * one would be stale the moment the week's day rolls over. A read costs no reading of the
 * account: the poller's last good windows are measured again.
 */
export function pollerQuotaSource(poller: QuotaPoller, now: () => number = () => Date.now()): QuotaSource {
  return {
    stop: () => poller.stop(),
    read: async () => {
      const envelope = poller.current()
      const windows = envelope.lastGood?.windows ?? []
      const boundary = weekBoundary(windows, now())
      const view: QuotaView = {
        windows,
        ...(boundary ? { boundary } : {}),
        ...(envelope.lastGoodAt !== undefined ? { readAt: envelope.lastGoodAt } : {}),
        ...(envelope.latest && !envelope.latest.available ? { unavailable: envelope.latest.reason } : {}),
      }
      return view
    },
  }
}

/**
 * The daemon's own quota source: it polls for the whole life of the dashboard,
 * not just during an agent, because the panel has to show where the account stands
 * even when nothing is running.
 *
 * Separate from the reading an agent takes for itself: that one dies with the agent, and
 * nothing stops a running agent over quota anyway. This one exists to draw the bar.
 */
export function defaultQuotaSource(): QuotaSource {
  const driver = new ClaudeCodeDriver()
  // Kept for the account-rotation command too: Claude refuses this read when asked too often, whoever asks.
  const poller = new QuotaPoller({
    read: async () => {
      const quota = await driver.readQuota()
      keepClaudeReading(quota)
      return quota
    },
  })
  poller.start()
  return pollerQuotaSource(poller)
}

import { QuotaPoller } from './quota-poller.js'
import { weekBoundary, type QuotaBoundary } from './quota-boundary.js'
import type { DriverQuotaUnavailableReason, DriverQuotaWindow, PersonalSetup, RunAgent } from '@openagt/hooks'
import { codingAgents } from '../agents.js'

/**
 * Everything the dashboard needs to draw the usage panel (#533): the account's
 * own windows, and where they stand against the quota boundary (#879).
 */
export interface QuotaView {
  /** The coding agent whose account it is, by its name for a person (`Claude Code`): the first that says its quota; none when none does. */
  agent?: string
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
 * The quota source of this computer's dashboard: it polls the first coding agent that says its
 * quota (`Driver.readQuota`), on the person's own login, for the whole life of the dashboard, not
 * just during a run, because the panel shows where the account stands even when nothing runs. A
 * distribution with no such agent has no reading.
 *
 * Separate from the reading an agent takes for itself: that one dies with the agent, and
 * nothing stops a running agent over quota anyway. This one exists to draw the bar.
 */
export function agentsQuotaSource(agents: () => Promise<readonly RunAgent[]> = () => codingAgents()): QuotaSource {
  // Each reading is kept for everyone on this computer by the read itself: the accounts card and
  // command answer from it, and a read another process makes at the same moment is this one's too.
  const found = agents().then(all => all.map(agent => ({ agent, driver: agent.driver({ env: process.env, personal: OWN_SETUP }) })).find(one => one.driver.readQuota !== undefined))
  const poller = new QuotaPoller({
    read: async () => {
      const driver = (await found)?.driver
      return driver?.readQuota ? driver.readQuota() : { available: false, reason: 'agent-not-found' }
    },
  })
  poller.start()
  const source = pollerQuotaSource(poller)
  return {
    stop: source.stop,
    read: async () => {
      const label = (await found.catch(() => undefined))?.agent.label
      return { ...(await source.read()), ...(label !== undefined ? { agent: label } : {}) }
    },
  }
}

/** The person's own setup, whole: a quota is the account's, whatever a run keeps of the setup. */
const OWN_SETUP: PersonalSetup = { memory: true, connectors: true, skills: true }

/** This computer's quota source, made at its first read and kept for the process's life. */
let here: QuotaSource | undefined

/** Where the account's quota stands against its boundary, as this computer's source reads it. */
export function quotaHere(): QuotaSource {
  return (here ??= agentsQuotaSource())
}

import { contextQuota } from './context.js'
import type { QuotaView } from '../dashboard/quota.js'

// The usage panel's surface (#533): where the account's subscription quota stands, and where the
// quota boundary (#879) sits. The source is wired into the dashboard context by the daemon, and the panel polls it for its
// whole life.

/** An honest empty view: no reading, and so no boundary to measure against. */
function noReading(): QuotaView {
  // No windows and no boundary rather than zeroes: an empty bar reads as
  // "nothing used", which is the one thing this panel must never imply.
  return { windows: [], unavailable: 'fetch-failed' }
}

/** Where the account's quota stands against its boundary. */
export async function onQuota(): Promise<QuotaView> {
  return contextQuota().read().catch(() => noReading())
}

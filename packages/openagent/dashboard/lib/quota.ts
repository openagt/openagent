import type { QuotaView } from '../../src/index.js'
import { onQuota } from '../rpc/quota.js'
import { usePolled } from './use-async.js'

// The usage panel's data (#535). The daemon polls the agent for us and caches the answer,
// so this only has to ask the daemon for what it already knows — cheap, unlike the read
// behind it. Prerender has no daemon, so it starts empty and loads on the client.

/** How often to ask the daemon for its cached reading. Cheap: no agent is spawned. */
const REFRESH_MS = 30_000

/**
 * The account's quota and where the limits stand, refreshed while the panel is open.
 *
 * `undefined` until the first answer arrives. A failed call keeps the last view rather
 * than blanking it: an empty bar reads as "nothing used".
 */
export function useQuota(): QuotaView | undefined {
  // Kept for the next visit: the page opens with the last usage, faded until it is read again.
  return usePolled<QuotaView | undefined>(onQuota, undefined, REFRESH_MS, [], { remember: 'quota', stored: true }).value
}

import { openEvents } from '../lib/rpc.js'

// The live feed's subscription (F3). Not an `rpc()` stub: it is a stream rather than a call, so it
// has its own endpoint and its own client (see `lib/rpc.ts`). Kept in this directory so every
// server-backed thing the dashboard reaches for is in one place.
export { openEvents as onEvents }
export type { EventChannel } from '../lib/rpc.js'

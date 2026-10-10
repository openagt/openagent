// Browser-safe entry for the dashboard client (#431). Only pure event projections live
// here — `formatOpenAgentEvent` and the run-view derivations — with no Node imports, so
// the client can import these at runtime without dragging the server barrel (relay,
// sandbox, node:fs/http, …) into the browser bundle. Types come from the root entry.
export { DRIVERS, DRIVER_LABELS, isDriverName, driverFromImpl, type DriverName } from './driver-names.js'
export { PUBLISH_LABELS, isPublishPick, offeredPublishPicks, publishPickIn, type PublishPick } from './publish-levels.js'
export { formatOpenAgentEvent } from './terminal.js'
export { formatBytes } from './format-bytes.js'
export { errorMessage } from './error-message.js'
export { pickedIds } from './events.js'
export {
  sessionInfo,
  agentErrors,
  type SessionInfo,
  type AgentError,
} from './agent-view.js'
// Which questions a run still waits on: one rule for the run page and the daemon's own reads.
export { pendingChoices } from './open-choices.js'
// The identity of a notification feed's item (#627). Pure, so the dashboard shares it with the
// item types rather than keeping a copy that drifts silently.
export { interventionKey, activityKey } from './dashboard/keys.js'
// The baseline half of the same engine (#1625): what counts as "already there" when a feed is first
// seen. The dashboard used to decide that by counting observations, which made a page loaded with no
// git host reach take an empty backlog for a real one. Pure, and its only import is a type.
export { SeenTracker } from './dashboard/keyed-watcher.js'
export type { ProjectionRead } from './dashboard/projects.js'
export { NOTIFICATION_DEFAULTS, MAX_SPEND_OFFSET, notifies, browserNotifyEnabled, notifyCategoryEnabled, type NotifyCategory } from './preference-defaults.js'
// Whether an address is truly local (#1051). The daemon decides the token gate with it and the
// dashboard labels the connection with it, so they must agree on what "local" means — the browser
// kept its own looser copy, which answered `false` for every 127.0.0.0/8 address but the first.
export { isLoopbackHost } from './loopback-host.js'
// How a pasted machine address is read, so the dialog and the daemon read a paste the same way.
export { parseMachineUrl } from './machine-url.js'
// A bridged question as the gate panel renders it (#1554): pure, so the client projects it itself.
export { bridgeChoiceRequest } from './dashboard/bridge-question.js'
// What a web run's cloud side is doing, from its record (#1668): pure, so every surface derives the same word.
export { cloudRunState, cloudRunActive, CLOUD_SESSION_WINDOW_MS, type CloudRunState } from './cloud-run-state.js'

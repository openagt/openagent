// Browser-safe entry for the dashboard client (#431). Only pure event projections live
// here — `formatRunEvent` and the run-view derivations — with no Node imports, so
// the client can import these at runtime without dragging the server barrel (sandbox,
// node:fs/http, …) into the browser bundle. Types come from the root entry.
export { PUBLISH_LABELS, isPublishPick, offeredPublishPicks, publishPickIn, type PublishPick } from './publish-levels.js'
export { formatRunEvent } from './terminal.js'
export { ACCENTS, DEFAULT_ACCENT_LABELS, accentOf, CODE_FONTS, DOCUMENT_FONTS, FONTS, fontFace, PALETTES, PALETTE_LABELS, type Accent, type CodeFont, type DocumentFont, type Font, type Palette } from './appearance.js'
// What every list calls a run, so the same run never goes by two names.
export { runName } from './run-name.js'
export { foldScreenRows } from './screens.js'
export { formatBytes } from './format-bytes.js'
export { errorMessage } from './error-message.js'
export { publishedBase } from '@openagt/agent-data/names'
export { typedRepository, type TypedRepository } from './typed-repository.js'
export { pickedIds } from './events.js'
export {
  sessionInfo,
  agentErrors,
  type SessionInfo,
  type AgentError,
} from './agent-view.js'
// Which questions a run still waits on: one rule for the run page and the daemon's own reads.
export { pendingChoices } from './open-choices.js'
// The identity of what waits on the person (#627). Pure, so the dashboard and its plugins share it
// with the item type rather than keeping a copy that drifts silently.
export { waitingKey } from './dashboard/keys.js'
// What a run needs of the person, in the two words every list says it in.
export { needsWord, type RunNeed } from './dashboard/waiting-words.js'
export type { ProjectionRead } from './dashboard/projects.js'


// How long a run just started counts as starting, so the page and a Stop wait for it alike.
export { STARTING_AT_MOST_MS } from './starting.js'
export { ALL_PROJECTS, CARD_WIDTHS, arrangeCards, widthsFor, type CardPlace, type CardWidth, type LayoutCard, type OverviewLayouts } from './overview-layout.js'

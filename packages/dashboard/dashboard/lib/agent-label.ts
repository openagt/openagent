import type { AgentMeta } from '../../src/index.js'
import { runName } from '../../src/client.js'
import { formatDateTimeShort } from './format-date.js'

// What to call a session in a list, and when a list should wait for that name rather than show the
// person's prompt and swap it a second later ({@link awaitingName}).
//
// The session's own short name comes first, the two to five words a small model gave it when the
// session opened (`agent-runner`'s `title.ts`), as Claude Code on the web names one. It is what a
// list is for: "README.md condensing" over the paragraph the person typed.
//
// `intent` is what the user typed, and it is often absent: a session whose record carries no
// ask has none. The rail used to print a bold "(no prompt)" for those
// and push the one fact that did identify them, the timestamp, into small muted text beside it.
// So the loudest thing on most rows said nothing, and the rows were told apart by the quietest.
//
// The fallbacks in order: the branch the agent named its work with (#326/#1725), then when nothing
// describes the agent, the time it started. A date is a poor name but a real one, and it belongs
// on the line that identifies the row. All but the date are `runName`, the rule the Human Queue
// names its runs by too, so a run goes by one name everywhere.
export function agentLabel(agent: Pick<AgentMeta, 'id' | 'title' | 'intent' | 'branch' | 'startedAt'>): string {
  return runName(agent) ?? formatDateTimeShort(agent.startedAt)
}

/**
 * How long a row waits, empty, for the name a run was started with to arrive ({@link awaitingName}).
 *
 * A small model answers in three to six seconds, and the ask gives up after a minute; past that the
 * row has waited long enough and shows what the person typed instead.
 */
export const NAMING_WAIT_MS = 60_000

/**
 * Whether a row should wait, rather than put the person's whole prompt where the name is going.
 *
 * A run is named moments after it starts, so a row that opens with the prompt swaps it for the name
 * a second later — the one flicker in a list that is otherwise still. Claude Code on the web has the
 * name from the first frame because it makes one server-side; ours is a model's answer, so the row
 * holds the place instead of filling it with something it is about to throw away.
 *
 * Only while a name is actually coming: naming turned off, a run too old, a subagent (never named),
 * or a run that already has one is answered right away, and so is a run with nothing else to show.
 */
export function awaitingName(
  agent: Pick<AgentMeta, 'id' | 'title' | 'intent' | 'branch' | 'startedAt' | 'parent'>,
  naming: boolean,
  now = Date.now(),
): boolean {
  if (!naming || agent.title !== undefined || agent.parent !== undefined) return false
  const started = Date.parse(agent.startedAt)
  return Number.isFinite(started) && now - started < NAMING_WAIT_MS
}

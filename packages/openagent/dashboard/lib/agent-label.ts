import type { AgentMeta } from '../../src/index.js'
import { formatDateTimeShort } from './format-date.js'

// What to call a session in a list.
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
// on the line that identifies the row.
export function agentLabel(agent: Pick<AgentMeta, 'id' | 'title' | 'intent' | 'branch' | 'startedAt'>): string {
  return agent.title?.trim() || agent.intent?.trim() || agent.branch?.trim() || formatDateTimeShort(agent.startedAt)
}

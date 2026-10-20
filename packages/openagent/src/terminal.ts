import type { DriverEvent, DriverRateLimit } from '@openagt/agent-driver'
import { pickedIds, type ChoiceOption, type OpenAgentEvent } from './events.js'

// The terminal surface for the agent's event stream: render one {@link OpenAgentEvent} as one
// human-readable line. This is the CLI's counterpart to the dashboard's read-model
// projections (run-view.ts) — a pure formatter over the same union, kept out of events.ts so
// the event contract stays a plain data module (and browser-safe for the client bundle).

/** Render a {@link OpenAgentEvent} as one human-readable line (terminal surface). */
export function formatOpenAgentEvent(event: OpenAgentEvent): string {
  switch (event.kind) {
    case 'session':
      return `◆ ${event.fake ? 'fake' : event.driver}${event.model ? ` (${event.model})` : ''} in ${event.workspace}${
        event.sessionLink ? ` — ${event.sessionLink}` : ''
      }`
    case 'session-update':
      return `  session ${event.sessionId}${event.sessionLink ? ` — ${event.sessionLink}` : ''}`
    case 'screen':
      return `◆ ${event.label}`
    case 'log':
      return `  ${event.message}`
    case 'error':
      return `✗ ${event.headline}${event.detail ? `\n    ${event.detail.replace(/\n/g, '\n    ')}` : ''}`
    case 'settled':
      return `◆ done for now — waiting for your next message`
    case 'branch':
      return `  branch: ${event.branch}`
    case 'cloud-anchor':
      return `  hand-off anchor: ${event.sha.slice(0, 7)}`
    case 'pull-request':
      return `  pull request: #${event.number}`
    case 'usage':
      return `  spend: $${event.costUsd.toFixed(4)}`
    case 'choice': {
      const mark = (o: ChoiceOption) =>
        event.multi ? (o.default ? '[x]' : '[ ]') : o.id === event.recommended ? '●' : '○'
      const opts = event.options.map(o => `    ${mark(o)} ${o.label}`).join('\n')
      return `? ${event.title}\n${opts}`
    }
    case 'choice-resolved':
      return `  ✓ chose ${pickedIds(event.picked).join(', ') || '(none)'} (${event.by})`
    case 'driver':
      return formatDriverEvent(event.event)
    case 'intent':
      return `▶ "${truncate(event.text)}"`
    case 'title':
      return `Named the session: ${truncate(event.text)}`
    case 'end':
      if (event.ok) return '✓ finished'
      if (event.stopped) return '■ stopped'
      if (event.waiting) return '? waiting for an answer'
      return `✗ failed: ${event.detail ?? 'unknown error'}`
  }
}

function formatDriverEvent(event: DriverEvent): string {
  switch (event.type) {
    case 'start':
      return `  › prompt: ${truncate(event.prompt, 140)}`
    // Normally consumed by telemetry before it reaches a stream (#1322); rendered anyway so a
    // stray one reads as what it is rather than crashing the formatter.
    case 'session':
      return `  session ${event.sessionId}`
    case 'model':
      return `  model ${event.model}`
    // A message being written reads as the text it has so far; a diary never holds one.
    case 'partial':
    case 'text':
      return `    ${truncate(event.text)}`
    case 'action':
      return event.detail !== undefined ? `    · ${event.label}  ${truncate(event.detail, 140)}` : `    · ${event.label}`
    case 'output':
      return `      ${event.failed ? '✗' : '→'} ${truncate(event.text, 140)}`
    case 'subagent':
      return `    ${event.status === 'ended' ? '✓' : event.status === 'failed' ? '✗' : '·'} subagent ${truncate(event.name ?? event.role ?? event.id, 60)}`
    case 'thought':
      return `    💭 ${truncate(event.text, 140)}`
    case 'plan':
      return `    ☐ plan: ${event.tasks.filter(task => task.status === 'completed').length} of ${event.tasks.length} done`
    case 'result':
      return `  ‹ turn complete`
    case 'rate-limit':
      return `    ${formatRateLimit(event.limit)}`
    case 'error':
      return `  ! agent error: ${event.message}`
    case 'notice':
      return `  ~ ${event.message}`
    case 'question':
      return `  ? ${truncate(event.question.title, 140)}`
  }
}

/** Quiet on the happy path: only worth a line when the quota is actually tight. */
function formatRateLimit(limit: DriverRateLimit): string {
  const resets = new Date(limit.resetsAt).toISOString()
  if (limit.status === 'rejected') return `✗ quota exhausted (${limit.window}), resets ${resets}`
  if (limit.status === 'allowed_warning') return `! quota running low (${limit.window}), resets ${resets}`
  return `· quota ${limit.status} (${limit.window}), resets ${resets}`
}

function truncate(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

import type { ChoiceRequest } from '../events.js'

// The shape of a question the browser bridge carries (#1237), and its projection onto the gate
// panel (#1554). Node-free on purpose: the dashboard client renders a bridged question through
// the same `QuestionPanel` a local gate gets, so it needs the projection at runtime, and the
// endpoint/store modules it would otherwise come from pull in node:crypto and node:http.

/** One answer a bridged question offers: the same fields an `await-choices` option carries. */
export interface BridgeOption {
  label: string
  detail?: string
  /** Starts checked, on a `multi` question. */
  default?: boolean
  /** Picking it hands the session back to the user instead of continuing it (#358). */
  stop?: boolean
}

/**
 * A question a cloud session is parked on, as reported by the bridge. The shape of the session's
 * own `await-choices` block (#1554), keyed by label rather than id: the page shows labels, and a
 * label is what the extension can type back.
 */
export interface BridgeQuestion {
  /** The cloud session that asked, which joins back to an agent through `AgentMeta.sessionId`. */
  sessionId: string
  title: string
  options: BridgeOption[]
  recommended?: string
  /** Several answers at once (#332): the pick is a subset of labels rather than one. */
  multi?: boolean
  /** When the daemon accepted it. Set by the daemon, never by the caller. */
  receivedAt: string
}

/**
 * A bridged question as the gate panel renders it (#1554): the same `ChoiceRequest` a local
 * agent's `choice` event carries, with the labels standing in for ids — a claude.ai page has no
 * ids, and the label is what can be typed back into it.
 */
export function bridgeChoiceRequest(question: BridgeQuestion): ChoiceRequest {
  return {
    id: `bridge:${question.sessionId}`,
    title: question.title,
    options: question.options.map(option => ({
      id: option.label,
      label: option.label,
      ...(option.detail ? { detail: option.detail } : {}),
      ...(option.default ? { default: true } : {}),
    })),
    ...(question.recommended ? { recommended: question.recommended } : {}),
    ...(question.multi ? { multi: true } : {}),
  }
}

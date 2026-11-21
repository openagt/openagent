// An agent's "Open session" link — offered only when it actually opens the agent. A headless Claude
// Code run has no per-session URL: OpenAgent defaults to the generic claude.ai/code entry,
// which opens the product page, not the session, so it isn't worth an action (the session id is
// still visible in the event log). A link is returned only when the URL genuinely encodes the id —
// a per-session deep link the user configured via `--session-link "…/{sessionId}"`.

/** The minimal shape of `sessionInfo(events)` this needs, kept structural so it never
 *  couples to OpenAgent's exact type. */
export interface SessionLike {
  sessionLink?: string | undefined
  sessionId?: string | undefined
}

export interface SessionLinkView {
  /** A real per-session deep link to open. */
  href: string
  /** The link text. */
  label: string
}

/** An agent's per-session deep link, or null when there is none worth showing. */
export function describeSessionLink(session?: SessionLike | null): SessionLinkView | null {
  const href = session?.sessionLink
  const id = session?.sessionId
  // Only a URL that actually encodes the id opens *this* session; anything else (the generic
  // claude.ai/code entry, or a literal link) is a dead end, so show nothing.
  if (!href || !id || !href.includes(id)) return null
  return { href, label: `Open session (${id}) ↗` }
}

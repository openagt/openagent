// The composer draft carried across a navigation inside the app, held in sessionStorage so the
// typed prompt never sits in the address bar, history, or a Referer header. The launcher
// rehydrates from it once. And the draft each box keeps in this browser, until it is sent, and the
// messages sent to a working run that it has not read yet, until it reads them.

/** sessionStorage key holding a carried draft, until the launcher takes it. */
const PENDING_DRAFT_KEY = 'oa.pending-draft'

/** sessionStorage, or undefined wherever this module is loaded without a browser behind it. */
function session(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

/**
 * Carry a draft across an in-app navigation (#1139). For a click that knows what the next session
 * should be about but lands on the launcher, where that knowledge would otherwise be dropped — a
 * hot ticket with no run of its own.
 *
 * Deliberately not a `?draft=` param: this navigation never leaves the tab, so there is no reason
 * to put the prompt in the address bar.
 */
export function stashPendingDraft(draft: string): void {
  session()?.setItem(PENDING_DRAFT_KEY, draft)
}

/** The carried draft, if any, cleared as it is read so a reload does not re-seed it. */
export function takePendingDraft(): string | null {
  const s = session()
  if (!s) return null
  const draft = s.getItem(PENDING_DRAFT_KEY)
  if (draft !== null) s.removeItem(PENDING_DRAFT_KEY)
  return draft
}

/** localStorage key prefix of the draft each box keeps: the launcher's by project, a session's by session. */
const KEPT_DRAFT_KEY = 'oa.draft:'

/** localStorage key prefix of the messages each run has not read yet. */
const KEPT_WAITING_KEY = 'oa.waiting:'

/** The draft the box `key` names was left with, as a chat app keeps one across a reload and a closed tab. */
export function keptDraft(key: string): string | undefined {
  return kept(KEPT_DRAFT_KEY + key)
}

/** Keep what the box `key` names holds; an empty box, as a sent prompt leaves it, keeps nothing. */
export function keepDraft(key: string, text: string): void {
  keep(KEPT_DRAFT_KEY + key, text.trim() === '' ? undefined : text)
}

/** The messages sent to `run` that it had not read when the page was left or reloaded. */
export function keptWaiting<Message>(run: string): Message[] {
  try {
    const messages = globalThis.localStorage?.getItem(KEPT_WAITING_KEY + run)
    return messages ? (JSON.parse(messages) as Message[]) : []
  } catch {
    return []
  }
}

/** Call `take` with the messages kept for `run` each time another tab keeps them; returns what stops it. */
export function onKeptWaiting<Message>(run: string, take: (messages: Message[]) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === KEPT_WAITING_KEY + run) take(keptWaiting<Message>(run))
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

/** Keep the messages `run` has not read yet; none keeps nothing. */
export function keepWaiting(run: string, messages: readonly unknown[]): void {
  keep(KEPT_WAITING_KEY + run, messages.length === 0 ? undefined : JSON.stringify(messages))
}

function kept(key: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(key) || undefined
  } catch {
    return undefined
  }
}

function keep(key: string, value: string | undefined): void {
  try {
    if (value === undefined) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, value)
  } catch {
    // A browser that keeps nothing still has it for this page's life.
  }
}

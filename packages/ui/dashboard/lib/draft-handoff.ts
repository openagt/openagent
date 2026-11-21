import { useCallback, useState } from 'react'

// The composer draft carried across a navigation inside the app, held in sessionStorage so the
// typed prompt never sits in the address bar, history, or a Referer header. The launcher
// rehydrates from it once. And the draft each box keeps in this browser, until it is sent, the
// messages sent to a working run that it has not read yet, until it reads them, and the message
// sent to continue an ended run, until it begins on it.

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

/**
 * A form's draft, kept in this browser as `keptDraft` keeps a box's: what was typed comes back after
 * a reload or a closed tab. `[draft, set, forget]`: `set` keeps each change, a draft that says what
 * `empty` says keeps nothing, and `forget` lets it go once it is saved or put away.
 */
export function useKeptDraft<T>(key: string, empty: T): [T, (change: (current: T) => T) => void, () => void] {
  const [draft, setDraft] = useState<T>(() => {
    const text = keptDraft(key)
    try {
      return text === undefined ? empty : { ...empty, ...(JSON.parse(text) as Partial<T>) }
    } catch {
      return empty
    }
  })
  const set = useCallback(
    (change: (current: T) => T): void =>
      setDraft(current => {
        const next = change(current)
        const text = JSON.stringify(next)
        keep(KEPT_DRAFT_KEY + key, text === JSON.stringify(empty) ? undefined : text)
        return next
      }),
    [key],
  )
  const forget = useCallback((): void => keep(KEPT_DRAFT_KEY + key, undefined), [key])
  return [draft, set, forget]
}

/** localStorage key prefix of the images each box keeps with its draft, by the names the dashboard kept them under. */
const KEPT_IMAGES_KEY = 'oa.draft-images:'

/** The images the box `key` names was left with. */
export function keptDraftImages(key: string): string[] {
  try {
    const names: unknown = JSON.parse(kept(KEPT_IMAGES_KEY + key) ?? '[]')
    return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : []
  } catch {
    return []
  }
}

/** Keep the images the box `key` names holds; none keeps nothing. */
export function keepDraftImages(key: string, names: readonly string[]): void {
  keep(KEPT_IMAGES_KEY + key, names.length === 0 ? undefined : JSON.stringify(names))
}

/** localStorage key prefix of the messages each run has not read yet. */
const KEPT_WAITING_KEY = 'oa.waiting:'

/** localStorage key prefix of the message each ended run was sent to continue it, until it writes that message as its prompt. */
const KEPT_SENDING_KEY = 'oa.sending:'

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

/** The message sent to continue `run` that it had not begun on when the page was left or reloaded. */
export function keptSending<Message>(run: string): Message | null {
  const message = kept(KEPT_SENDING_KEY + run)
  try {
    return message ? (JSON.parse(message) as Message) : null
  } catch {
    return null
  }
}

/** Keep the message sent to continue `run`; none keeps nothing. */
export function keepSending(run: string, message: unknown): void {
  keep(KEPT_SENDING_KEY + run, message === null ? undefined : JSON.stringify(message))
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

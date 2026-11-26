import { useEffect, useRef } from 'react'

/** Whether the keyboard in front of the person is a Mac's, whose shortcuts are pressed with ⌘. */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The key a shortcut is pressed with, as that keyboard names it: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD_KEY = MAC ? '⌘' : 'Ctrl'

/** A shortcut as that keyboard names it: `shortcut('B')` is ⌘B on a Mac, Ctrl+B elsewhere. */
export function shortcut(key: string): string {
  return MAC ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`
}

/** Where a shortcut works, in the order the list of shortcuts shows them. */
export const SHORTCUT_PLACES = ['Anywhere', 'Jump', 'The message box', 'A working agent', 'A question', 'Saved prompts', 'Customizing the Overview'] as const

interface Shortcut {
  /** The keys that take it, exactly as `KeyboardEvent.key` names them (`k`, not `K`); `1-9` is any of those digits. The first is the one the list shows. */
  keys: readonly string[]
  /** Held with ⌘ or Ctrl, either on any keyboard; Shift and Alt held with it change nothing, but a shortcut held with Shift too (`shift`). */
  mod?: true
  /** Held with Shift. With ⌘ or Ctrl, the letter is taken in either case: a Mac's browser says `d` for ⌘⇧D, elsewhere `D`. */
  shift?: true
  /** Only where nothing is typed into: a key typed into a text field is that field's. */
  outsideFields?: true
  where: (typeof SHORTCUT_PLACES)[number]
  does: string
}

/** Every key the dashboard takes, read by the handlers that take them and by the list of shortcuts alike. */
export const SHORTCUTS = {
  jump: { keys: ['k'], mod: true, where: 'Anywhere', does: 'Jump to a run, a project or a page' },
  shortcuts: { keys: ['?'], outsideFields: true, where: 'Anywhere', does: 'Show the keyboard shortcuts' },
  sidebar: { keys: ['b'], mod: true, where: 'Anywhere', does: 'Hide or show the sidebar' },
  changesTab: { keys: ['d'], mod: true, shift: true, where: 'Anywhere', does: 'Open Changes in the side panel' },
  filesTab: { keys: ['f'], mod: true, shift: true, where: 'Anywhere', does: 'Open Files in the side panel' },
  newTab: { keys: ['Enter'], mod: true, where: 'Jump', does: 'Open the marked place in a new tab' },
  send: { keys: ['Enter'], where: 'The message box', does: 'Send' },
  newLine: { keys: ['Enter'], shift: true, where: 'The message box', does: 'Start a new line' },
  sendLater: { keys: ['Enter'], mod: true, where: 'The message box', does: 'Send, read by a working agent after its turn' },
  stop: { keys: ['Escape'], where: 'A working agent', does: 'Stop the agent' },
  pick: { keys: ['1-9'], outsideFields: true, where: 'A question', does: 'Pick that answer' },
  answer: { keys: ['Enter'], mod: true, where: 'A question', does: 'Send the answer' },
  deletePrompt: { keys: ['Delete', 'Backspace'], where: 'Saved prompts', does: 'Delete the marked prompt' },
  savePrompt: { keys: ['Enter'], mod: true, where: 'Saved prompts', does: 'Save the prompt being written' },
  leaveCustomize: { keys: ['Escape'], where: 'Customizing the Overview', does: 'Leave Customize, as Done does' },
} as const satisfies Record<string, Shortcut>

export type ShortcutId = keyof typeof SHORTCUTS

/** What a key handler is given, the DOM's event or React's. */
type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'> & ({ isComposing: boolean } | { nativeEvent: { isComposing: boolean } })

/** Whether the target is a field that takes typed text. */
export function typedInto(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
}

/** Whether this key press is the shortcut `id`. A key pressed to compose a character is never one. */
export function pressed(event: KeyPress, id: ShortcutId): boolean {
  const shortcut: Shortcut = SHORTCUTS[id]
  if ('nativeEvent' in event ? event.nativeEvent.isComposing : event.isComposing) return false
  const letter = shortcut.mod && shortcut.shift ? event.key.toLowerCase() : event.key
  const key = shortcut.keys.some(k => (k === '1-9' ? /^[1-9]$/.test(event.key) : k === letter))
  if (!key || (shortcut.outsideFields && typedInto(event.target))) return false
  if (shortcut.mod) return (event.metaKey || event.ctrlKey) && (!shortcut.shift || event.shiftKey)
  // A named key says Shift apart; a character's Shift is how it is typed.
  if (event.key.length > 1 && event.shiftKey !== (shortcut.shift ?? false)) return false
  return !event.metaKey && !event.ctrlKey && !event.altKey
}

/** The character a key press types, or none: a named key, a key held with ⌘, Ctrl or Alt, or one pressed to compose. */
export function typedCharacter(event: KeyPress): string | undefined {
  if ('nativeEvent' in event ? event.nativeEvent.isComposing : event.isComposing) return undefined
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey ? event.key : undefined
}

/** The keys of a shortcut as this keyboard writes them, one cap each: ⌘ K on a Mac, Ctrl K elsewhere. */
export function shortcutKeys(id: ShortcutId): string[] {
  const shortcut: Shortcut = SHORTCUTS[id]
  const first = shortcut.keys[0]!
  const key = first === '1-9' ? '1–9' : first === 'Escape' ? 'Esc' : first.length === 1 ? first.toUpperCase() : first
  return [...(shortcut.mod ? [MOD_KEY] : []), ...(shortcut.shift ? [MAC ? '⇧' : 'Shift'] : []), key]
}

/**
 * Whether anything is open over the page, a hint aside: a key pressed then is the open thing's.
 * Each popup of the kit says its kind in `data-overlay`; one playing its closing motion is closed.
 */
export function overlayOpen(): boolean {
  return document.querySelector('[data-overlay]:not([data-overlay="hint"]):not([data-closed])') !== null
}

/**
 * Run `run` at the shortcut `id`, pressed anywhere on the page: not while anything is open over
 * it, nor when what has the focus took the key itself.
 */
export function useShortcut(id: ShortcutId, run: () => void): void {
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !pressed(event, id) || overlayOpen()) return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id])
}

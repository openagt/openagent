/** Whether the keyboard in front of the person is a Mac's, whose shortcuts are pressed with ⌘. */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The key a shortcut is pressed with, as that keyboard names it: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD_KEY = MAC ? '⌘' : 'Ctrl'

/** A shortcut as that keyboard names it: `shortcut('B')` is ⌘B on a Mac, Ctrl+B elsewhere. */
export function shortcut(key: string): string {
  return MAC ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`
}

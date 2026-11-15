// What a shortcut is said as, by the platform the page is on: held with ⌘ on Apple's, with Ctrl
// elsewhere, where there is no ⌘ to press. The handlers take either key; what the page says is the
// one the person has. One rule for every hint: the sidebar's, the question's Submit, the box's.

/** Whether the page runs on one of Apple's platforms, where a shortcut is held with ⌘. */
export const ON_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/** The key a shortcut is held with, as a hint names it: "⌘" or "Ctrl". */
export const MOD_KEY = ON_APPLE ? '⌘' : 'Ctrl'

/** A shortcut held with that key, as a hint says it: "⌘B" on a Mac, "Ctrl+B" elsewhere. */
export function shortcut(key: string): string {
  return ON_APPLE ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`
}

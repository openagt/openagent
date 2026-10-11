/**
 * Read the link another computer's OpenAgent gives for a new device (its Settings, Devices, Add
 * device): where this computer is let in, and the code that lets it in once. The code rides the
 * link after the `#`. Not a web address is `null`, and so is a link with no code.
 *
 * A leaf with no Node in it: the dashboard reads a paste with it as the person types, and the
 * daemon reads it again before it asks to be let in.
 */
export interface MachineLink {
  /** Where the other OpenAgent answers, as an origin (`http://studio.local:4201`). */
  url: string
  /** Where this computer asks to be let in, and later takes itself out: the link without its code. */
  door: string
  /** The code, good once. */
  code: string
}

export function parseMachineLink(pasted: string): MachineLink | null {
  try {
    const u = new URL(pasted.trim())
    // A scheme-less paste like `studio.local:4201/…` parses with `studio.local:` as the scheme
    // and an opaque `null` origin: not a machine's address.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const code = u.hash.slice(1)
    if (!code) return null
    return { url: u.origin, door: u.origin + u.pathname, code }
  } catch {
    return null
  }
}

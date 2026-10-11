/**
 * Read the link another computer's OpenAgent gives for a new device (its Settings, Devices, Add
 * device): where this computer is let in, and the code that lets it in once. The code rides the
 * link after the `#`. A server's link carries one thing more after the code and a dot: what the
 * server's key is known by. Not a web address is `null`, and so is a link with no code.
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
  /** What the machine's key is known by, when the link says: a call then goes only to a machine that shows that key. */
  pin?: string
}

export function parseMachineLink(pasted: string): MachineLink | null {
  try {
    const u = new URL(pasted.trim())
    // A scheme-less paste like `studio.local:4201/…` parses with `studio.local:` as the scheme
    // and an opaque `null` origin: not a machine's address.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const [code, pin] = u.hash.slice(1).split('.')
    if (!code) return null
    // A key is shown only over HTTPS: a link that names one and is not HTTPS was bent on its way.
    if (pin && u.protocol !== 'https:') return null
    return { url: u.origin, door: u.origin + u.pathname, code, ...(pin ? { pin } : {}) }
  } catch {
    return null
  }
}

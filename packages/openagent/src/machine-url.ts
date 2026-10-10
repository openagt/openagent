/**
 * Pull a machine's address and key out of the line it prints when it is opened to the network
 * (`http://host:port/?token=…`, cli.ts). The address is cut down to its origin. Not a web
 * address is `null`; one with no `token` has an empty key, which cannot be saved.
 *
 * A leaf with no Node in it: the dashboard reads a paste with it as the person types, and the
 * daemon reads it again before it saves.
 */
export function parseMachineUrl(pasted: string): { url: string; token: string } | null {
  try {
    const u = new URL(pasted.trim())
    // A scheme-less paste like `localhost:4200/?token=…` parses with `localhost:` as the scheme
    // and an opaque `null` origin: not a machine's address.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return { url: u.origin, token: u.searchParams.get('token') ?? '' }
  } catch {
    return null
  }
}

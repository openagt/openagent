// A project's address in the dashboard's URL (#784): what the page shows, and what `openagent`
// prints for a project it opens, so the two say one thing.
//
// A project's address is its folder's name: the id with its `-<hash>` off. The id itself is the
// address only where the name cannot be one: a project before it in the registry has the same
// folder name, or the name is a page's word. Only the address is a name: the id stays what
// preferences, records and other machines know the project by, and it still opens the project.
//
// Pure and browser-safe: the dashboard imports it, and so does the server.

/**
 * The words the dashboard keeps for itself, after a project's address and in its place: `overview`,
 * a project's Overview, and `settings` (#958), where Settings was a page. Settings is a dialog over
 * the page you are on now, carried as `?settings=`; the old address still opens it, over the
 * Overview. No module's page takes either.
 */
export const OVERVIEW_SEGMENT = 'overview'
export const SETTINGS_SEGMENT = 'settings'

/**
 * Whether a segment can name a page a module adds (#1774): a lowercase letter, then lowercase
 * letters and digits, and not a word the dashboard keeps. Whichever module claims the segment gets
 * it, and the shell says "no such page" when none does, or when the picked project has no package
 * that adds it.
 */
export function isPageSegment(segment: string): boolean {
  return /^[a-z][a-z0-9]*$/.test(segment) && segment !== OVERVIEW_SEGMENT && segment !== SETTINGS_SEGMENT
}

/** Each registered project's address, and the project an address or an id names. */
export interface ProjectAddresses {
  /** The project's address: its name, or its id where the name cannot be one. An unknown id is its own address. */
  addressOf(projectId: string): string
  /** The project a first segment names, by its address or by its id; undefined for none. */
  projectOf(segment: string): string | undefined
}

/**
 * The addresses of the registered projects, in the registry's order, beside the pages' words.
 * A project's name is its id without the `-<hash>`: its folder's name, as the id writes it. The
 * name is its address unless a page has that word, since pages win, or a project before it in the
 * registry already has that name: the first one added keeps it, so adding a second clone changes
 * no address in use.
 */
export function projectAddresses(projectIds: readonly string[], pageWords: readonly string[]): ProjectAddresses {
  const taken = new Set<string>([OVERVIEW_SEGMENT, SETTINGS_SEGMENT, ...pageWords, ...projectIds])
  const byId = new Map<string, string>()
  const byAddress = new Map<string, string>()
  for (const id of projectIds) {
    const name = nameOf(id)
    const address = name && !taken.has(name) ? name : id
    taken.add(address)
    byId.set(id, address)
    byAddress.set(address, id)
  }
  return {
    addressOf: id => byId.get(id) ?? id,
    projectOf: segment => byAddress.get(segment) ?? (byId.has(segment) ? segment : undefined),
  }
}

/** No project registered: every first segment is a page's, or a project's nobody registered. */
export const NO_PROJECTS: ProjectAddresses = projectAddresses([], [])

/** A project id's name: the id without its last `-<hash>`; empty for an id with no dash. */
function nameOf(projectId: string): string {
  const dash = projectId.lastIndexOf('-')
  return dash > 0 ? projectId.slice(0, dash) : ''
}

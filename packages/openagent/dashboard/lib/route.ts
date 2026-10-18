// The dashboard's address (#784), project first: `/` is the Overview of every project, `/logs` a
// module's page over every project, and a project's own pages start with its address:
// `/gemstack` its "New agent" page, `/gemstack/overview` its Overview, `/gemstack/logs` a module's
// page with that project picked, `/gemstack/<agentId>` one agent. The project in the address is the
// one every page shows (#1513), the pick of the sidebar's select; a project's agent and "New agent"
// pages show every project instead with `?all`. The URL is the selection — what used to be three
// pieces of React state guessing at each other, which is where the #761/#766/#768/#774 bugs came from.
//
// A project's address is its folder's name: the id with its `-<hash>` off. The id itself is the
// address only where the name cannot be one: a project before it in the registry has the same
// folder name, or the name is a page's word. Only the address is a name: the id stays what
// preferences, records and other machines know the project by, and it still opens the project.
//
// `agentId` is the agent id (`AgentMeta.id`), not the agent's conversation id with its driver:
// only the agent id is ours, stable, and already the name of its worktree directory. It is its
// start time, so it starts with a digit, and a page's word with a letter: that is what tells
// `/gemstack/<agentId>` from `/gemstack/logs`.
//
// The ids are URL-safe by construction (the registry derives a project id from its path, an agent
// id from its start time), so the segments are still encoded/decoded — a URL typed by hand is input.

/**
 * The words the dashboard keeps for itself, after a project's address and in its place: `overview`,
 * a project's Overview, and `settings` (#958), where Settings was a page. Settings is a dialog over
 * the page you are on now, carried as `?settings=`; the old address still opens it, over the
 * Overview. No module's page takes either.
 */
const OVERVIEW_SEGMENT = 'overview'
const SETTINGS_SEGMENT = 'settings'

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

/** What the dashboard is looking at, as carried by the URL. */
export interface Route {
  /**
   * The Settings dialog, open over the page the rest of the route names: the entry it shows, or
   * `''` for its first one. Absent when it is closed. Carried as `?settings=<entry>`.
   */
  settings?: string
  /** The project whose agent or "New agent" page shows, by id; null for an Overview and a module's page. */
  projectId: string | null
  /** The selected agent, or null for the project's "New agent" page. */
  agentId: string | null
  /** A module's page (#1774), by its segment; no project's own page shows there. */
  page?: string
  /** The segments after a module page's own, decoded: `/logs/a` carries `['a']`. */
  pagePath?: string[]
  /**
   * The one project every page shows (#1513), by id; absent when every project shows. It is the
   * project the address starts with. On a project's agent and "New agent" pages it is that
   * project, or absent when `?all` is there: never another one.
   */
  scope?: string
}

/** The query parameter, with no value, that says every project shows on a project's own pages. */
const ALL_PARAM = 'all'

/** The query parameter that carries {@link Route.settings}. */
const SETTINGS_PARAM = 'settings'

/**
 * Read the route out of a URL's path and query, naming projects by `projects`. A first segment
 * that names no project is a module's page when it can be one, and else a project nobody
 * registered, whose page says so. Extra segments are ignored.
 */
export function parseRoute(url: string, projects: ProjectAddresses): Route {
  const [pathname = '', search = ''] = url.split('?')
  const params = new URLSearchParams(search)
  const entry = params.get(SETTINGS_PARAM)
  const settings = entry !== null ? { settings: entry } : {}
  const [first, ...rest] = pathname.split('/').filter(Boolean).map(decodeSegment)
  // The old page's address, `/settings/<entry>` included: the dialog over the Overview.
  if (first === SETTINGS_SEGMENT) return { projectId: null, agentId: null, settings: entry ?? rest[0] ?? '' }
  if (!first || first === OVERVIEW_SEGMENT) return { projectId: null, agentId: null, ...settings }
  const named = projects.projectOf(first)
  if (named === undefined && isPageSegment(first)) return { projectId: null, agentId: null, page: first, pagePath: rest, ...settings }
  const projectId = named ?? first
  const [second, ...after] = rest
  if (second === OVERVIEW_SEGMENT) return { projectId: null, agentId: null, scope: projectId, ...settings }
  if (second !== undefined && isPageSegment(second)) return { projectId: null, agentId: null, page: second, pagePath: after, scope: projectId, ...settings }
  return { projectId, agentId: second ?? null, ...(params.has(ALL_PARAM) ? {} : { scope: projectId }), ...settings }
}

/** The URL for a route, its path and its query — the inverse of {@link parseRoute}. */
export function formatRoute(route: Route, projects: ProjectAddresses): string {
  const all = !route.page && route.projectId && !route.scope ? [ALL_PARAM] : []
  const settings = route.settings !== undefined ? [`${SETTINGS_PARAM}=${encodeURIComponent(route.settings)}`] : []
  const query = [...all, ...settings].join('&')
  return formatPath(route, projects) + (query ? `?${query}` : '')
}

/**
 * `url` with the query parameters of `search` that are not the route's own added to it: what a
 * module's page mirrored there (a list's filters) stays when only the picked project changes, or
 * when Settings opens or closes over the page.
 */
export function keepPageQuery(url: string, search: string): string {
  const [path = '', own = ''] = url.split('?')
  const params = new URLSearchParams(search)
  for (const name of [ALL_PARAM, SETTINGS_PARAM, ...new URLSearchParams(own).keys()]) params.delete(name)
  const query = [params.toString(), own].filter(Boolean).join('&')
  return query ? `${path}?${query}` : path
}

function formatPath({ projectId, agentId, page, pagePath, scope }: Route, projects: ProjectAddresses): string {
  // A project's own page starts with its project, any other page with the picked one, if any.
  const project = !page && projectId ? projectId : scope
  const head = project ? [projects.addressOf(project)] : []
  const tail = page ? [page, ...(pagePath ?? [])] : projectId ? (agentId ? [agentId] : []) : project ? [OVERVIEW_SEGMENT] : []
  return '/' + [...head, ...tail].map(encodeURIComponent).join('/')
}

/** A percent-encoded segment, or the raw one when it is malformed (a hand-typed URL is input). */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

// The dashboard's address (#784): `/` is the Overview, `/{projectId}` a project's home/launcher,
// `/{projectId}/{sessionId}` one session. The one project every page shows (#1513) is `?project={projectId}`
// on the Overview and a module's page; a project's own pages show their project unless `?all` says
// every project shows, so its id is never in the address twice. The URL is the selection — what used to be three pieces
// of React state guessing at each other, which is where the #761/#766/#768/#774 bugs came from.
//
// `sessionId` is the agent id (`AgentMeta.id`), not the agent's conversation id with its driver:
// only the agent id is ours, stable, and already the name of its worktree directory. The URL
// carries the id, never the word, so the segment's name here is the last "session" left of #771 —
// the buttons above it say agent (D5).
//
// Both ids are URL-safe by construction (the registry derives a project id from its path, an agent
// id from its start time), so the segments are still encoded/decoded — a URL typed by hand is input.

/**
 * The one first segment the dashboard keeps for itself: `/settings` (#958), where Settings was a
 * page. Settings is a dialog over the page you are on now, carried as `?settings=`; the old
 * address still opens it, over the Overview. Every other bare word is a module's page (#1774).
 *
 * Safe to reserve because a project id is never this word: the registry builds one as
 * `<slugified basename>-<hash in base36>`, so every real id carries a `-<hash>` suffix.
 */
const SETTINGS_SEGMENT = 'settings'

/**
 * Whether a first segment names a page a module adds (#1774) rather than a project: a lowercase
 * letter, then lowercase letters and digits. Never a project's id, which always carries a
 * `-<hash>` suffix, so the router reserves no module's word: whichever module claims the segment
 * gets it, and the shell says "no such page" when none does, or when the picked project
 * has no package that adds it.
 */
export function isPageSegment(segment: string): boolean {
  return /^[a-z][a-z0-9]*$/.test(segment)
}

/** What the dashboard is looking at, as carried by the URL. */
export interface Route {
  /**
   * The Settings dialog, open over the page the rest of the route names: the entry it shows, or
   * `''` for its first one. Absent when it is closed. Carried as `?settings=<entry>`.
   */
  settings?: string
  /** The selected project, or null for the Overview. */
  projectId: string | null
  /** The selected session (agent id), or null for the project's home/launcher. */
  agentId: string | null
  /** A module's page (#1774), by its segment; no project and no agent is selected there. */
  page?: string
  /** The segments after a module page's own, decoded: `/logs/a` carries `['a']`. */
  pagePath?: string[]
  /**
   * The one project every page shows (#1513), by id; absent when every project shows. Carried as
   * `?project=<id>` on the Overview and a module's page. On a project's own pages it is that
   * project, or absent when `?all` is there: never another one.
   */
  scope?: string
}

/** The query parameter that carries {@link Route.scope} off a project's own pages. */
const SCOPE_PARAM = 'project'

/** The query parameter, with no value, that says every project shows on a project's own pages. */
const ALL_PARAM = 'all'

/** The query parameter that carries {@link Route.settings}. */
const SETTINGS_PARAM = 'settings'

/**
 * Read the route out of a URL's path and query. Anything unparseable is the Overview, and extra
 * segments are ignored. A project's own page shows its project unless `?all` is there; a
 * `?project=` on it is ignored.
 */
export function parseRoute(url: string): Route {
  const [pathname = '', search = ''] = url.split('?')
  const params = new URLSearchParams(search)
  const scoped = params.get(SCOPE_PARAM)
  const scope = scoped ? { scope: scoped } : {}
  const entry = params.get(SETTINGS_PARAM)
  const settings = entry !== null ? { settings: entry } : {}
  const segments = pathname.split('/').filter(Boolean).map(decodeSegment)
  const [first, second] = segments
  // The old page's address, `/settings/<entry>` included: the dialog over the Overview.
  if (first === SETTINGS_SEGMENT) return { projectId: null, agentId: null, settings: entry ?? second ?? '', ...scope }
  if (!first) return { projectId: null, agentId: null, ...scope, ...settings }
  if (isPageSegment(first)) return { projectId: null, agentId: null, page: first, pagePath: segments.slice(1), ...scope, ...settings }
  return { projectId: first, agentId: second ?? null, ...(params.has(ALL_PARAM) ? {} : { scope: first }), ...settings }
}

/** The URL for a route, its path and its query — the inverse of {@link parseRoute}. */
export function formatRoute(route: Route): string {
  const ownProject = !route.page ? route.projectId : null
  const scope = ownProject ? (route.scope ? [] : [ALL_PARAM]) : route.scope ? [`${SCOPE_PARAM}=${encodeURIComponent(route.scope)}`] : []
  const settings = route.settings !== undefined ? [`${SETTINGS_PARAM}=${encodeURIComponent(route.settings)}`] : []
  const query = [...scope, ...settings].join('&')
  return formatPath(route) + (query ? `?${query}` : '')
}

/**
 * `url` with the query parameters of `search` that are not the route's own added to it: what a
 * module's page mirrored there (a list's filters) stays when only the picked project changes, or
 * when Settings opens or closes over the page.
 */
export function keepPageQuery(url: string, search: string): string {
  const [path = '', own = ''] = url.split('?')
  const params = new URLSearchParams(search)
  for (const name of [SCOPE_PARAM, ALL_PARAM, SETTINGS_PARAM, ...new URLSearchParams(own).keys()]) params.delete(name)
  const query = [params.toString(), own].filter(Boolean).join('&')
  return query ? `${path}?${query}` : path
}

function formatPath({ projectId, agentId, page, pagePath }: Route): string {
  if (page) return ['', page, ...(pagePath ?? [])].map(encodeURIComponent).join('/')
  if (!projectId) return '/'
  const project = encodeURIComponent(projectId)
  return agentId ? `/${project}/${encodeURIComponent(agentId)}` : `/${project}`
}

/**
 * The address of a module's page as a link holds it, for a link that must also open in a new
 * tab: the page's segment, with the one project the dashboard is showing when one is picked, so
 * the new tab shows that project too.
 */
export function pageHref(segment: string, url: string = typeof window === 'undefined' ? '' : window.location.pathname + window.location.search): string {
  const { scope } = parseRoute(url)
  return formatRoute({ projectId: null, agentId: null, page: segment, ...(scope ? { scope } : {}) })
}

/** A percent-encoded segment, or the raw one when it is malformed (a hand-typed URL is input). */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

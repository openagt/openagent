// The dashboard's address (#784): `/` is the Overview, `/{projectId}` a project's home/launcher,
// `/{projectId}/{sessionId}` one session. `?project={projectId}` on any of them is the one project
// every page shows (#1513). The URL is the selection — what used to be three pieces
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
 * The one first segment that names a view rather than a project (#958): the dashboard's own
 * settings. Every other bare word is a module's page (#1774): the dashboard reserves nothing else,
 * not even for the tickets, whose pages are their package's module's.
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
  /** A top-level view belonging to no project (#958). */
  view?: 'settings'
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
   * `?project=<id>`. On a project's own pages it is that project or absent, never another one.
   */
  scope?: string
}

/** The query parameter that carries {@link Route.scope}. */
const SCOPE_PARAM = 'project'

/**
 * Read the route out of a URL's path and query. Anything unparseable is the Overview, and extra
 * segments are ignored. A project's own page scoped to another project is scoped to its own.
 */
export function parseRoute(url: string): Route {
  const [pathname = '', search = ''] = url.split('?')
  const scoped = new URLSearchParams(search).get(SCOPE_PARAM)
  const scope = scoped ? { scope: scoped } : {}
  const segments = pathname.split('/').filter(Boolean).map(decodeSegment)
  const [first, second] = segments
  if (first === SETTINGS_SEGMENT) return { view: 'settings', projectId: null, agentId: null, ...scope }
  if (!first) return { projectId: null, agentId: null, ...scope }
  if (isPageSegment(first)) return { projectId: null, agentId: null, page: first, pagePath: segments.slice(1), ...scope }
  return { projectId: first, agentId: second ?? null, ...(scoped ? { scope: first } : {}) }
}

/** The URL for a route, its path and its query — the inverse of {@link parseRoute}. */
export function formatRoute(route: Route): string {
  const ownProject = !route.view && !route.page ? route.projectId : null
  const scope = route.scope ? (ownProject ?? route.scope) : null
  return formatPath(route) + (scope ? `?${SCOPE_PARAM}=${encodeURIComponent(scope)}` : '')
}

/**
 * `url` with the query parameters of `search` that are not the route's own added to it: what a
 * module's page mirrored there (a list's filters) stays when only the picked project changes.
 */
export function keepPageQuery(url: string, search: string): string {
  const [path = '', own = ''] = url.split('?')
  const params = new URLSearchParams(search)
  params.delete(SCOPE_PARAM)
  for (const [name, value] of new URLSearchParams(own)) params.set(name, value)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

function formatPath({ view, projectId, agentId, page, pagePath }: Route): string {
  if (view === 'settings') return `/${SETTINGS_SEGMENT}`
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
export function pageHref(segment: string, search: string = typeof window === 'undefined' ? '' : window.location.search): string {
  const scope = new URLSearchParams(search).get(SCOPE_PARAM)
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

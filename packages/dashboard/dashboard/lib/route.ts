// The dashboard's address (#784), project first: `/` is the Overview of every project, `/logs` a
// module's page over every project, and a project's own pages start with its address:
// `/gemstack` its "New agent session" page, `/gemstack/overview` its Overview, `/gemstack/logs` a module's
// page with that project picked, `/gemstack/<agentId>` one agent. The project in the address is the
// one every page shows (#1513), the pick of the sidebar's select; a project's agent and "New agent session"
// pages show every project instead with `?all`. Several projects picked are `?project=<address>`, once
// each: `/overview?project=a&project=b`, `/logs?project=a&project=b`, and on a project's own pages the
// others than the address's own, `/a/<agentId>?project=b`. The URL is the selection — what used to be three
// pieces of React state guessing at each other, which is where the #761/#766/#768/#774 bugs came from.
//
// A session with no project has the address `/session/<agentId>`, and `/session` is the "New agent
// session" page with no project: `session` stands where a project's address would (`SESSIONS_ID`).
//
// A project's address is its folder's name, or its id where the name cannot be one: the rule is
// `src/project-address.ts`, shared with the server, which prints it for the project `openagent` opens.
//
// `agentId` is the agent id (`AgentMeta.id`), not the agent's conversation id with its driver:
// only the agent id is ours, stable, and already the name of its worktree directory. It is its
// start time, so it starts with a digit, and a page's word with a letter: that is what tells
// `/gemstack/<agentId>` from `/gemstack/logs`.
//
// The ids are URL-safe by construction (the registry derives a project id from its path, an agent
// id from its start time), so the segments are still encoded/decoded — a URL typed by hand is input.

import { OVERVIEW_SEGMENT, SESSIONS_ID, SETTINGS_SEGMENT, isPageSegment, type ProjectAddresses } from '../../src/project-address.js'

/** What the dashboard is looking at, as carried by the URL. */
export interface Route {
  /**
   * The Settings dialog, open over the page the rest of the route names: the entry it shows, or
   * `''` for its first one. Absent when it is closed. Carried as `?settings=<entry>`.
   */
  settings?: string
  /**
   * A page inside the Settings entry shown, by what the entry knows it as (a saved machine's id,
   * under Devices): what a link from elsewhere on the page opens. Carried as `&item=<it>`.
   */
  settingsItem?: string
  /** The project whose agent or "New agent session" page shows, by id; null for an Overview and a module's page. */
  projectId: string | null
  /** The selected agent, or null for the project's "New agent session" page. */
  agentId: string | null
  /** A module's page (#1774), by its segment; no project's own page shows there. */
  page?: string
  /** The segments after a module page's own, decoded: `/logs/a` carries `['a']`. */
  pagePath?: string[]
  /**
   * The projects every page shows (#1513), by id, never empty; absent when every project shows.
   * One is the project the address starts with, several are `?project=`. On a project's agent and
   * "New agent session" pages it holds that project, or is absent when `?all` is there.
   */
  scope?: readonly string[]
}

/** The query parameter, with no value, that says every project shows on a project's own pages. */
const ALL_PARAM = 'all'

/** The query parameter, once per project, that names the projects picked beside the address's own. */
const PROJECT_PARAM = 'project'

/** The query parameter that carries {@link Route.settings}. */
export const SETTINGS_PARAM = 'settings'
export const SETTINGS_ITEM_PARAM = 'item'

/**
 * Read the route out of a URL's path and query, naming projects by `projects`. A first segment
 * that names no project is a module's page when it can be one, and else a project nobody
 * registered, whose page says so. Extra segments are ignored.
 */
export function parseRoute(url: string, projects: ProjectAddresses): Route {
  const [pathname = '', search = ''] = url.split('?')
  const params = new URLSearchParams(search)
  const entry = params.get(SETTINGS_PARAM)
  const item = params.get(SETTINGS_ITEM_PARAM)
  const settings = entry !== null ? { settings: entry, ...(item ? { settingsItem: item } : {}) } : {}
  const [first, ...rest] = pathname.split('/').filter(Boolean).map(decodeSegment)
  const named = (address: string) => projects.projectOf(address) ?? address
  // The projects named beside the address's own, each once.
  const others = params.getAll(PROJECT_PARAM).filter(Boolean).map(named)
  const scopeOf = (own: string[]): { scope?: string[] } => {
    const picked = [...new Set([...own, ...others])]
    return picked.length ? { scope: picked } : {}
  }
  // The old page's address, `/settings/<entry>` included: the dialog over the Overview.
  if (first === SETTINGS_SEGMENT) return { projectId: null, agentId: null, settings: entry ?? rest[0] ?? '' }
  if (!first || first === OVERVIEW_SEGMENT) return { projectId: null, agentId: null, ...scopeOf([]), ...settings }
  if (projects.projectOf(first) === undefined && isPageSegment(first)) return { projectId: null, agentId: null, page: first, pagePath: rest, ...scopeOf([]), ...settings }
  const projectId = named(first)
  const [second, ...after] = rest
  if (second === OVERVIEW_SEGMENT) return { projectId: null, agentId: null, ...scopeOf([projectId]), ...settings }
  if (second !== undefined && isPageSegment(second)) return { projectId: null, agentId: null, page: second, pagePath: after, ...scopeOf([projectId]), ...settings }
  // The sessions with no project are no project to show alone: every project shows beside them.
  return { projectId, agentId: second ?? null, ...(params.has(ALL_PARAM) || projectId === SESSIONS_ID ? {} : scopeOf([projectId])), ...settings }
}

/** The URL for a route, its path and its query — the inverse of {@link parseRoute}. */
export function formatRoute(route: Route, projects: ProjectAddresses): string {
  const ownPage = !route.page && route.projectId !== null
  const all = ownPage && route.projectId !== SESSIONS_ID && !route.scope ? [ALL_PARAM] : []
  // The projects picked that the path does not name: on a project's own page every one but it, on
  // any other page every one when several are. A session with no project shows every project.
  const inPath = ownPage ? route.projectId : route.scope?.length === 1 ? route.scope[0] : null
  const others = ownPage && route.projectId === SESSIONS_ID ? [] : (route.scope ?? []).filter(id => id !== inPath)
  const named = others.map(id => `${PROJECT_PARAM}=${encodeURIComponent(projects.addressOf(id))}`)
  const settings = route.settings !== undefined ? [`${SETTINGS_PARAM}=${encodeURIComponent(route.settings)}`, ...(route.settingsItem ? [`${SETTINGS_ITEM_PARAM}=${encodeURIComponent(route.settingsItem)}`] : [])] : []
  const query = [...all, ...named, ...settings].join('&')
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
  for (const name of [ALL_PARAM, PROJECT_PARAM, SETTINGS_PARAM, SETTINGS_ITEM_PARAM, ...new URLSearchParams(own).keys()]) params.delete(name)
  const query = [params.toString(), own].filter(Boolean).join('&')
  return query ? `${path}?${query}` : path
}

function formatPath({ projectId, agentId, page, pagePath, scope }: Route, projects: ProjectAddresses): string {
  // A project's own page starts with its project, any other page with the one picked, if only one is.
  const project = !page && projectId ? projectId : scope?.length === 1 ? scope[0] : undefined
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

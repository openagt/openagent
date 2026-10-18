// The dashboard's address (#784), project first: `/` is the Overview of every project, `/logs` a
// module's page over every project, and a project's own pages start with its address:
// `/gemstack` its "New agent" page, `/gemstack/overview` its Overview, `/gemstack/logs` a module's
// page with that project picked, `/gemstack/<agentId>` one agent. The project in the address is the
// one every page shows (#1513), the pick of the sidebar's select; a project's agent and "New agent"
// pages show every project instead with `?all`. The URL is the selection — what used to be three
// pieces of React state guessing at each other, which is where the #761/#766/#768/#774 bugs came from.
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

import { OVERVIEW_SEGMENT, SETTINGS_SEGMENT, isPageSegment, type ProjectAddresses } from '../../src/project-address.js'

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

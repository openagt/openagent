import { isPageSegment, type Route } from './route.js'

// A link into a project's files (#1774), and where the dashboard opens it. A queued entry, a hot
// ticket, any page's link may point at a path inside the project's repository, such as
// `tickets/2026-01-01_x.md`. The dashboard has no page of its own for such a path: the page is a
// module's, if any installed package brings one, and the dashboard names no module. So the
// convention, documented on `ModulePageProps`: the path's first segment names the page, which
// opens in that project with the rest as its own path — `/<project>/tickets/2026-01-01_x.md`.

/** A repository path's page segment and the rest: `tickets/a.md` → `{ segment: 'tickets', rest: ['a.md'] }`; nothing for a path with no page-shaped first segment or no rest. */
export function dataLinkParts(href: string): { segment: string; rest: string[] } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/')) return undefined
  const [segment, ...rest] = href.split('/').filter(Boolean)
  if (!segment || !isPageSegment(segment) || rest.length === 0) return undefined
  return { segment, rest }
}

/**
 * The route a link into `projectId`'s files opens, when one of `pages` (the mounted module pages,
 * by segment) claims the path's first segment; `undefined` when none does, so the link is shown
 * as text and opens nothing.
 */
export function dataLinkRoute(projectId: string, href: string, pages: readonly { segment: string }[]): Route | undefined {
  const parts = dataLinkParts(href)
  if (!parts || !pages.some(page => page.segment === parts.segment)) return undefined
  return { projectId: null, agentId: null, page: parts.segment, pagePath: parts.rest, scope: projectId }
}

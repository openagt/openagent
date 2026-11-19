import { isPageSegment } from '../../src/project-address.js'

// A link into a project's files (#1774), and which page opens it. A queued entry, a hot ticket, any
// page's link may point at a path inside the project's repository, such as
// `tickets/2026-01-01_x.md`. The dashboard has no page of its own for such a path: the page is a
// module's, if any installed package brings one, and the dashboard names no module. So the
// convention, documented on `ModulePageProps`: the path's first segment names the page, which
// opens in that project with the rest as its own path — `/<project>/tickets/2026-01-01_x.md`
// (`use-file-names.ts`).

/** A repository path's page segment and the rest: `tickets/a.md` → `{ segment: 'tickets', rest: ['a.md'] }`; nothing for a path with no page-shaped first segment or no rest. */
export function dataLinkParts(href: string): { segment: string; rest: string[] } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/')) return undefined
  const [segment, ...rest] = href.split('/').filter(Boolean)
  if (!segment || !isPageSegment(segment) || rest.length === 0) return undefined
  return { segment, rest }
}

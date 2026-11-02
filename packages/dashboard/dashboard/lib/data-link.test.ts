import { describe, expect, it } from 'vitest'
import { dataLinkParts, dataLinkRoute } from './data-link.js'

// A link into a project's files opens the mounted page named by its first segment (#1774) in that
// project, at `/<project>/<segment>/<rest…>`; with no such page mounted, it opens nothing.
describe('dataLinkRoute', () => {
  const pages = [{ segment: 'tickets' }, { segment: 'logs' }]

  it('opens the mounted page named by the first segment in the project, with the rest as its path', () => {
    expect(dataLinkRoute('p1', 'tickets/2026-01-01_x.md', pages)).toEqual({ projectId: null, agentId: null, page: 'tickets', pagePath: ['2026-01-01_x.md'], scope: 'p1' })
    expect(dataLinkRoute('p1', 'tickets/2026-01-01_x.md/plan', pages)).toEqual({ projectId: null, agentId: null, page: 'tickets', pagePath: ['2026-01-01_x.md', 'plan'], scope: 'p1' })
  })

  it('opens nothing when no page claims the segment, for an absolute URL, or for a bare file', () => {
    expect(dataLinkRoute('p1', 'tickets/2026-01-01_x.md', [{ segment: 'logs' }])).toBeUndefined()
    expect(dataLinkRoute('p1', 'https://example.com/tickets/x', pages)).toBeUndefined()
    expect(dataLinkRoute('p1', 'README.md', pages)).toBeUndefined()
    expect(dataLinkRoute('p1', '/tickets/x.md', pages)).toBeUndefined()
    expect(dataLinkRoute('p1', 'Tickets/x.md', pages)).toBeUndefined()
  })

  it('splits a path into its page segment and the rest', () => {
    expect(dataLinkParts('tickets/a/b.md')).toEqual({ segment: 'tickets', rest: ['a', 'b.md'] })
    expect(dataLinkParts('tickets/')).toBeUndefined()
  })
})

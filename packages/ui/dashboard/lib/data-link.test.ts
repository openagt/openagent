import { describe, expect, it } from 'vitest'
import { dataLinkParts } from './data-link.js'

// A link into a project's files names the page that opens it by its first segment (#1774), in that
// project, at `/<project>/<segment>/<rest…>`.
describe('dataLinkParts', () => {
  it('splits a path into its page segment and the rest', () => {
    expect(dataLinkParts('tickets/2026-01-01_x.md')).toEqual({ segment: 'tickets', rest: ['2026-01-01_x.md'] })
    expect(dataLinkParts('tickets/a/b.md')).toEqual({ segment: 'tickets', rest: ['a', 'b.md'] })
  })

  it('is nothing for an absolute URL or path, a bare file, a first segment no page could have, or no rest', () => {
    expect(dataLinkParts('https://example.com/tickets/x')).toBeUndefined()
    expect(dataLinkParts('/tickets/x.md')).toBeUndefined()
    expect(dataLinkParts('README.md')).toBeUndefined()
    expect(dataLinkParts('Tickets/x.md')).toBeUndefined()
    expect(dataLinkParts('tickets/')).toBeUndefined()
  })
})

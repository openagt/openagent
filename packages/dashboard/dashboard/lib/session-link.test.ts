import { describe, expect, it } from 'vitest'
import { describeSessionLink } from './session-link.js'

describe('describeSessionLink', () => {
  it('returns null when there is no link', () => {
    expect(describeSessionLink(null)).toBeNull()
    expect(describeSessionLink({})).toBeNull()
    expect(describeSessionLink({ sessionId: 'abc' })).toBeNull()
  })

  it('returns null for the generic Claude Code entry (opens the product page, not the session)', () => {
    expect(describeSessionLink({ sessionLink: 'https://claude.ai/code', sessionId: '532ccc4b' })).toBeNull()
  })

  it('returns null for a literal link that does not encode the id', () => {
    expect(describeSessionLink({ sessionLink: 'https://foo.test', sessionId: 'x1' })).toBeNull()
  })

  it('returns null before the id is reported', () => {
    expect(describeSessionLink({ sessionLink: 'https://claude.ai/code' })).toBeNull()
  })

  it('returns a link only for a real deep link that encodes the id', () => {
    const view = describeSessionLink({ sessionLink: 'https://example.com/s/532ccc4b', sessionId: '532ccc4b' })
    expect(view).toEqual({ href: 'https://example.com/s/532ccc4b', label: 'Open session (532ccc4b) ↗' })
  })
})

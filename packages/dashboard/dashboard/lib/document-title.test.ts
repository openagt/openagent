import { describe, expect, it } from 'vitest'
import { openagentTitle } from './document-title.js'

describe('openagentTitle', () => {
  it('is the bare brand with no count and no project', () => {
    expect(openagentTitle(0)).toBe('OpenAgent')
    expect(openagentTitle(0, null)).toBe('OpenAgent')
  })

  it('prefixes the needs-you count when there is one', () => {
    expect(openagentTitle(2)).toBe('(2) OpenAgent')
  })

  it('scopes to the selected project', () => {
    expect(openagentTitle(0, 'gemstack')).toBe('gemstack — OpenAgent')
  })

  it('combines the count and the project', () => {
    expect(openagentTitle(2, 'gemstack')).toBe('(2) gemstack — OpenAgent')
  })

  it('drops the count when zero', () => {
    expect(openagentTitle(0, 'gemstack')).toBe('gemstack — OpenAgent')
  })
})

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

describe('openagentTitle with the page', () => {
  it("puts the page's own name first, before the project and after the count", () => {
    expect(openagentTitle(2, 'shop', 'Logs')).toBe('(2) Logs · shop — OpenAgent')
    expect(openagentTitle(0, 'shop', 'ask which colour')).toBe('ask which colour · shop — OpenAgent')
  })

  it('names the page alone when no project is picked', () => {
    expect(openagentTitle(1, null, 'Agents')).toBe('(1) Agents — OpenAgent')
  })
})

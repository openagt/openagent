import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// Each test reads the module fresh, as a page load does: the width is read from the browser once.
async function load(kept?: string) {
  if (kept !== undefined) localStorage.setItem('oa.sidebar-width', kept)
  vi.resetModules()
  return import('./sidebar-width.js')
}

afterEach(() => localStorage.clear())

describe('the sidebar\'s width', () => {
  test('never set, the default; set, kept in this browser within its bounds, and read so on the next load; taken back, forgotten', async () => {
    const width = await load()
    const { result } = renderHook(() => width.useSidebarWidth())
    expect(result.current).toBe(width.SIDEBAR_DEFAULT)
    act(() => width.setSidebarWidth(300))
    expect(result.current).toBe(300)
    expect(localStorage.getItem('oa.sidebar-width')).toBe('300')
    act(() => width.setSidebarWidth(9999))
    expect(result.current).toBe(width.SIDEBAR_MAX)
    act(() => width.setSidebarWidth(10))
    expect(result.current).toBe(width.SIDEBAR_MIN)

    const next = await load()
    expect(renderHook(() => next.useSidebarWidth()).result.current).toBe(next.SIDEBAR_MIN)
    act(() => next.setSidebarWidth(undefined))
    expect(localStorage.getItem('oa.sidebar-width')).toBeNull()
  })

  test('a kept width out of bounds reads within them; one that is no number reads as the default', async () => {
    const wide = await load('5000')
    expect(renderHook(() => wide.useSidebarWidth()).result.current).toBe(wide.SIDEBAR_MAX)
    const junk = await load('wide')
    expect(renderHook(() => junk.useSidebarWidth()).result.current).toBe(junk.SIDEBAR_DEFAULT)
  })
})

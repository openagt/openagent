import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { holdEntry, openAgents, openPermissions, openSettings, useRoute } from './use-route.js'
import { projectAddresses } from '../../src/project-address.js'

// F1: this used to mock Vike's `usePageContext` and `navigate`. There is nothing to mock now —
// the hook reads `window.location` and writes through `history`, both of which jsdom implements,
// so these drive the real thing.

const at = (path: string): void => window.history.replaceState(null, '', path)

const projects = projectAddresses(['my-repo-a1'], ['logs'])

describe('useRoute', () => {
  beforeEach(() => {
    at('/')
  })

  it('reads the route from the live URL', () => {
    at('/my-repo/1-run')
    expect(renderHook(() => useRoute(projects)).result.current.route).toEqual({ projectId: 'my-repo-a1', agentId: '1-run', scope: 'my-repo-a1' })
  })

  it('navigates to a route, and the hook re-reads it', () => {
    const { result } = renderHook(() => useRoute(projects))
    act(() => result.current.go({ projectId: 'my-repo-a1', agentId: '1-run', scope: 'my-repo-a1' }))
    expect(window.location.pathname).toBe('/my-repo/1-run')
    expect(result.current.route).toEqual({ projectId: 'my-repo-a1', agentId: '1-run', scope: 'my-repo-a1' })
  })

  it('a navigation is a history entry, so Back returns to where you were', () => {
    const { result } = renderHook(() => useRoute(projects))
    act(() => result.current.go({ projectId: 'my-repo-a1', agentId: null, scope: 'my-repo-a1' }))
    act(() => result.current.go({ projectId: 'my-repo-a1', agentId: '1-run', scope: 'my-repo-a1' }))
    expect(window.history.length).toBeGreaterThan(1)
    expect(window.location.pathname).toBe('/my-repo/1-run')
  })

  it('replaces the history entry when asked, rather than adding one', () => {
    const { result } = renderHook(() => useRoute(projects))
    act(() => result.current.go({ projectId: 'my-repo-a1', agentId: '1-run', scope: 'my-repo-a1' }))
    const entries = window.history.length
    act(() => result.current.go({ projectId: 'my-repo-a1', agentId: null, scope: 'my-repo-a1' }, { replace: true }))
    expect(window.location.pathname).toBe('/my-repo')
    expect(window.history.length).toBe(entries)
  })

  it('does not add a history entry for where it already is', () => {
    at('/my-repo')
    const { result } = renderHook(() => useRoute(projects))
    const entries = window.history.length
    act(() => result.current.go({ projectId: 'my-repo-a1', agentId: null, scope: 'my-repo-a1' }))
    expect(window.history.length).toBe(entries)
  })

  it('follows Back and Forward, which the browser drives', () => {
    const { result } = renderHook(() => useRoute(projects))
    act(() => result.current.go({ projectId: 'my-repo-a1', agentId: '1-run', scope: 'my-repo-a1' }))
    // jsdom dispatches popstate asynchronously for back(), so drive the event the way it would.
    act(() => {
      window.history.replaceState(null, '', '/my-repo')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current.route).toEqual({ projectId: 'my-repo-a1', agentId: null, scope: 'my-repo-a1' })
  })

  it('Back to a page that scrolled comes back to its place, once the page is tall enough to have it again', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(800)
    const tall = vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(0)
    let grown = (): void => {}
    vi.stubGlobal('ResizeObserver', class { constructor(seen: () => void) { grown = seen } observe() {} disconnect() {} })
    try {
      const { result } = renderHook(() => useRoute(projects))
      act(() => result.current.go({ projectId: 'my-repo-a1', agentId: '1-run', scope: 'my-repo-a1' }))
      scrollY.mockReturnValue(0)
      // Back: the entry left kept its place, and the lists that fill the page have not shown yet.
      await act(async () => {
        const back = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }))
        window.history.back()
        await back
      })
      expect(window.location.pathname).toBe('/')
      expect(scrollTo).not.toHaveBeenCalled()
      tall.mockReturnValue(800 + window.innerHeight)
      grown()
      expect(scrollTo).toHaveBeenCalledWith(0, 800)
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })

  it('reads the picked project off the address, and a change of it alone is a navigation (#1513)', () => {
    at('/my-repo/logs')
    const { result } = renderHook(() => useRoute(projects))
    expect(result.current.route).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: [], scope: 'my-repo-a1' })
    act(() => result.current.go({ projectId: null, agentId: null, page: 'logs' }))
    expect(window.location.pathname + window.location.search).toBe('/logs')
    expect(result.current.route).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: [] })
  })

  it('reads the address again when the projects it names change', () => {
    at('/my-repo')
    const { result, rerender } = renderHook(({ named }) => useRoute(named), { initialProps: { named: projectAddresses([], []) } })
    expect(result.current.route).toEqual({ projectId: 'my-repo', agentId: null, scope: 'my-repo' })
    rerender({ named: projects })
    expect(result.current.route).toEqual({ projectId: 'my-repo-a1', agentId: null, scope: 'my-repo-a1' })
  })

  it("on a project's own page the project is picked, and `?all` is every project", () => {
    at('/my-repo')
    const { result } = renderHook(() => useRoute(projects))
    act(() => result.current.go({ projectId: 'my-repo-a1', agentId: null }))
    expect(window.location.pathname + window.location.search).toBe('/my-repo?all')
    expect(result.current.route).toEqual({ projectId: 'my-repo-a1', agentId: null })
    act(() => result.current.go({ projectId: 'my-repo-a1', agentId: '1-run', scope: 'my-repo-a1' }))
    expect(window.location.pathname + window.location.search).toBe('/my-repo/1-run')
  })
})

// Opening Settings from a part of the page that has no route to hand: the "Run on" menu's "Add a machine…".
describe('openSettings', () => {
  beforeEach(() => {
    at('/')
  })

  it('opens a Settings entry over the page you are on, its own query kept, as a step Back undoes', () => {
    at('/my-repo/1-run?all')
    const { result } = renderHook(() => useRoute(projects))
    const entries = window.history.length
    act(() => openSettings('devices'))
    expect(window.location.pathname + window.location.search).toBe('/my-repo/1-run?all=&settings=devices')
    expect(window.history.length).toBe(entries + 1)
    expect(result.current.route.settings).toBe('devices')
  })
})

describe('openPermissions and openAgents', () => {
  it('keep the project the address picks, as the sidebar does, and every project where none is picked', () => {
    at('/my-repo/overview')
    const { result } = renderHook(() => useRoute(projects))
    act(() => openPermissions())
    expect(window.location.pathname).toBe('/my-repo/permissions')
    expect(result.current.route).toEqual({ projectId: null, agentId: null, page: 'permissions', pagePath: [], scope: 'my-repo-a1' })
    act(() => openAgents())
    expect(window.location.pathname).toBe('/my-repo/agents')
    at('/logs')
    act(() => openPermissions())
    expect(window.location.pathname).toBe('/permissions')
    at('/my-repo/1-run?all')
    act(() => openAgents())
    expect(window.location.pathname).toBe('/agents')
  })
})

describe('holdEntry', () => {
  /** Whether leaving the document now would have the browser ask. */
  const asks = (): boolean => {
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    return leaving.defaultPrevented
  }

  it('has the browser ask before the document is left while an entry is held, and only then', () => {
    expect(asks()).toBe(false)
    const release = holdEntry(() => {})
    expect(asks()).toBe(true)
    release()
    expect(asks()).toBe(false)
  })

  it('a hold that replaced another asks until it is released itself', () => {
    const first = holdEntry(() => {})
    const second = holdEntry(() => {})
    first()
    expect(asks()).toBe(true)
    second()
    expect(asks()).toBe(false)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRoute } from './use-route.js'
import { projectAddresses } from './route.js'

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

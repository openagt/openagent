import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRoute } from './use-route.js'

// F1: this used to mock Vike's `usePageContext` and `navigate`. There is nothing to mock now —
// the hook reads `window.location` and writes through `history`, both of which jsdom implements,
// so these drive the real thing.

const at = (path: string): void => window.history.replaceState(null, '', path)

describe('useRoute', () => {
  beforeEach(() => {
    at('/')
  })

  it('reads the route from the live URL', () => {
    at('/my-repo/run-1')
    expect(renderHook(() => useRoute()).result.current.route).toEqual({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' })
  })

  it('navigates to a route, and the hook re-reads it', () => {
    const { result } = renderHook(() => useRoute())
    act(() => result.current.go({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' }))
    expect(window.location.pathname).toBe('/my-repo/run-1')
    expect(result.current.route).toEqual({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' })
  })

  it('a navigation is a history entry, so Back returns to where you were', () => {
    const { result } = renderHook(() => useRoute())
    act(() => result.current.go({ projectId: 'my-repo', agentId: null, scope: 'my-repo' }))
    act(() => result.current.go({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' }))
    expect(window.history.length).toBeGreaterThan(1)
    expect(window.location.pathname).toBe('/my-repo/run-1')
  })

  it('replaces the history entry when asked, rather than adding one', () => {
    const { result } = renderHook(() => useRoute())
    act(() => result.current.go({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' }))
    const entries = window.history.length
    act(() => result.current.go({ projectId: 'my-repo', agentId: null, scope: 'my-repo' }, { replace: true }))
    expect(window.location.pathname).toBe('/my-repo')
    expect(window.history.length).toBe(entries)
  })

  it('does not add a history entry for where it already is', () => {
    at('/my-repo')
    const { result } = renderHook(() => useRoute())
    const entries = window.history.length
    act(() => result.current.go({ projectId: 'my-repo', agentId: null, scope: 'my-repo' }))
    expect(window.history.length).toBe(entries)
  })

  it('follows Back and Forward, which the browser drives', () => {
    const { result } = renderHook(() => useRoute())
    act(() => result.current.go({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' }))
    // jsdom dispatches popstate asynchronously for back(), so drive the event the way it would.
    act(() => {
      window.history.replaceState(null, '', '/my-repo')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current.route).toEqual({ projectId: 'my-repo', agentId: null, scope: 'my-repo' })
  })

  it('reads the picked project off the query, and a change of it alone is a navigation (#1513)', () => {
    at('/?project=my-repo')
    const { result } = renderHook(() => useRoute())
    expect(result.current.route).toEqual({ projectId: null, agentId: null, scope: 'my-repo' })
    act(() => result.current.go({ projectId: null, agentId: null }))
    expect(window.location.pathname + window.location.search).toBe('/')
    expect(result.current.route).toEqual({ projectId: null, agentId: null })
  })

  it("on a project's own page the project is picked, and `?all` is every project", () => {
    at('/my-repo')
    const { result } = renderHook(() => useRoute())
    act(() => result.current.go({ projectId: 'my-repo', agentId: null }))
    expect(window.location.pathname + window.location.search).toBe('/my-repo?all')
    expect(result.current.route).toEqual({ projectId: 'my-repo', agentId: null })
    act(() => result.current.go({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' }))
    expect(window.location.pathname + window.location.search).toBe('/my-repo/run-1')
  })
})

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const onPreferences = vi.hoisted(() => vi.fn())
const patchPreferences = vi.hoisted(() => vi.fn())
const onProjectPresets = vi.hoisted(() => vi.fn())
const saveProjectPresets = vi.hoisted(() => vi.fn())
vi.mock('../rpc/preferences.js', () => ({
  onPreferences,
  patchPreferences,
  onProjectPresets,
  saveProjectPresets,
}))

const flush = () => act(async () => {
  await Promise.resolve()
  await Promise.resolve()
})

/** Put the test on a project's page: the URL is the selection (#784), and #840 reads it. */
const openProject = (projectId: string | null) =>
  window.history.replaceState({}, '', projectId ? `/${projectId}` : '/')

describe('preferences', () => {
  beforeEach(() => {
    // The cache is module state, so each test needs a fresh module instance.
    vi.resetModules()
    onPreferences.mockReset()
    // The daemon merges the patch and hands back what it stored (#1148); with nothing else
    // stored, that is the patch itself.
    patchPreferences.mockReset().mockImplementation(async (patch: unknown) => ({ ok: true, preferences: patch }))
    onProjectPresets.mockReset().mockResolvedValue([])
    saveProjectPresets.mockReset().mockResolvedValue({ ok: true })
    openProject(null)
  })

  test('an optimistic update made during the initial load survives the load resolving', async () => {
    let resolveLoad: (p: unknown) => void = () => {}
    onPreferences.mockReturnValue(new Promise(r => (resolveLoad = r)))
    const { usePreferences, updatePreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    // The load is in flight; the user turns browser notifications off before it resolves.
    act(() => updatePreferences({ notifyBrowser: false }))
    expect(result.current.notifyBrowser).toBe(false)

    // The load now resolves with the server's pre-toggle value; the toggle must win.
    await act(async () => {
      resolveLoad({ notifyBrowser: true })
      await Promise.resolve()
    })
    expect(result.current.notifyBrowser).toBe(false)
  })

  test('the initial load populates the cache when no optimistic write raced it', async () => {
    onPreferences.mockResolvedValue({ notifyBrowser: false, notifyNewActivity: true })
    const { usePreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    await flush()
    expect(result.current).toEqual({ notifyBrowser: false, notifyNewActivity: true })
  })

  test('a screen can tell the preferences not read yet from the preferences read', async () => {
    let resolveLoad: (p: unknown) => void = () => {}
    onPreferences.mockReturnValue(new Promise(r => (resolveLoad = r)))
    const { usePreferences, usePreferencesLoaded } = await import('./preferences.js')

    const { result } = renderHook(() => ({ preferences: usePreferences(), loaded: usePreferencesLoaded() }))
    expect(result.current.loaded).toBe(false)
    await act(async () => {
      resolveLoad({ startFrom: { p1: 'local' } })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ preferences: { startFrom: { p1: 'local' } }, loaded: true })
  })

  // A stale tab reverting settings it never touched (#1148).

  test('a write sends only the keys it changed, so it cannot replay the rest', async () => {
    onPreferences.mockResolvedValue({ theme: 'dark', notifyBrowser: false })
    const { usePreferences, updatePreferences } = await import('./preferences.js')

    renderHook(() => usePreferences())
    await flush()
    act(() => updatePreferences({ notifyBrowser: true }))

    // Not `{ theme: 'dark', notifyBrowser: true }`: sending the whole cached object is how a tab
    // opened before someone else changed the theme wrote the old theme back over it.
    expect(patchPreferences).toHaveBeenCalledWith({ notifyBrowser: true })
  })

  test("a write adopts the daemon's answer, so a stale tab converges", async () => {
    onPreferences.mockResolvedValue({ theme: 'dark' })
    // Another tab set the theme to light in the meantime; the merged result carries it back.
    patchPreferences.mockResolvedValue({ ok: true, preferences: { theme: 'light', notifyBrowser: true } })
    const { usePreferences, updatePreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    await flush()
    act(() => updatePreferences({ notifyBrowser: true }))
    await flush()

    expect(result.current).toEqual({ theme: 'light', notifyBrowser: true })
  })

  test('a reply that lands after a newer write does not undo it', async () => {
    onPreferences.mockResolvedValue({})
    let resolveFirst: (value: unknown) => void = () => {}
    patchPreferences
      .mockReturnValueOnce(new Promise(r => (resolveFirst = r)))
      .mockResolvedValue({ ok: true, preferences: { theme: 'light' } })
    const { usePreferences, updatePreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    await flush()
    act(() => updatePreferences({ theme: 'dark' }))
    act(() => updatePreferences({ theme: 'light' }))
    await flush()
    expect(result.current.theme).toBe('light')

    // The first write's answer arrives last, carrying the value the user already moved off.
    await act(async () => {
      resolveFirst({ ok: true, preferences: { theme: 'dark' } })
      await Promise.resolve()
    })
    expect(result.current.theme).toBe('light')
  })

  test('a failed write leaves the optimistic value in place', async () => {
    onPreferences.mockResolvedValue({ theme: 'dark' })
    // What a host with no preferences store (the relay) answers.
    patchPreferences.mockResolvedValue({ ok: false, error: 'preferences are not enabled on this server' })
    const { usePreferences, updatePreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    await flush()
    act(() => updatePreferences({ theme: 'light' }))
    await flush()

    expect(result.current.theme).toBe('light')
  })

  test('refreshPreferences re-reads your tier, so a background tab stops showing a stale value', async () => {
    openProject('app-a-14csz1v')
    onPreferences.mockResolvedValue({ theme: 'dark', model: 'sonnet' })
    const { usePreferences, refreshPreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    await flush()
    expect(result.current).toEqual({ theme: 'dark', model: 'sonnet' })

    onPreferences.mockResolvedValue({ theme: 'light', model: 'opus' })
    refreshPreferences()
    await flush()
    expect(result.current).toEqual({ theme: 'light', model: 'opus' })
  })

  test('refreshPreferences does not overwrite a write still in flight', async () => {
    onPreferences.mockResolvedValue({ theme: 'dark' })
    patchPreferences.mockReturnValue(new Promise(() => {}))
    const { usePreferences, updatePreferences, refreshPreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    await flush()
    act(() => updatePreferences({ theme: 'light' }))
    // The read fires while the write is still out, and answers with the pre-write value.
    refreshPreferences()
    await flush()

    expect(result.current.theme).toBe('light')
  })

  test('themePreference falls back to system and resolvedDark honours the choice (#725)', async () => {
    const { themePreference, resolvedDark } = await import('./preferences.js')

    expect(themePreference({})).toBe('system')
    expect(themePreference({ theme: 'light' })).toBe('light')

    // Fixed choices ignore the OS; `system` follows it.
    expect(resolvedDark('dark', false)).toBe(true)
    expect(resolvedDark('light', true)).toBe(false)
    expect(resolvedDark('system', true)).toBe(true)
    expect(resolvedDark('system', false)).toBe(false)
  })
})

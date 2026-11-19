import { afterEach, describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { mountedOf, useListedPages, type MountedModules } from './use-modules.js'

const modules = (loaded: boolean, pages: { id: string; label: string; projects: string[] }[] = []): MountedModules =>
  mountedOf({ views: { 'app.page': pages.map(page => ({ ...page, place: 'app.page' as const, View: () => null, package: 'a-package' })) }, loaded })

afterEach(() => localStorage.clear())

describe('the pages the sidebar lists', () => {
  test('on the next load, the last load\'s pages are listed from the first frame, until the modules are imported', () => {
    const logs = { id: 'logs', label: 'Logs', projects: ['p1'] }
    renderHook(() => useListedPages(modules(true, [logs]))).unmount()
    const { result, rerender } = renderHook(({ mounted }) => useListedPages(mounted), { initialProps: { mounted: modules(false) } })
    expect(result.current).toEqual([logs])
    rerender({ mounted: modules(true, [{ id: 'queue', label: 'Queue', projects: ['p1'] }]) })
    expect(result.current?.map(page => page.id)).toEqual(['queue'])
  })

  test('with nothing kept, not known until the modules are imported', () => {
    const { result, rerender } = renderHook(({ mounted }) => useListedPages(mounted), { initialProps: { mounted: modules(false) } })
    expect(result.current).toBeNull()
    rerender({ mounted: modules(true) })
    expect(result.current).toEqual([])
  })
})

import { afterEach, describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useListedPages, type MountedModules } from './use-modules.js'

const modules = (loaded: boolean, pages: { segment: string; label: string; projects: string[] }[] = []): MountedModules =>
  ({ pages: pages.map(page => ({ ...page, Page: () => null, package: 'a-package' })), cards: [], linkActions: [], panels: [], runSlots: [], settings: [], everyPage: [], loaded }) as MountedModules

afterEach(() => localStorage.clear())

describe('the pages the sidebar lists', () => {
  test('on the next load, the last load\'s pages are listed from the first frame, until the modules are imported', () => {
    const logs = { segment: 'logs', label: 'Logs', projects: ['p1'] }
    renderHook(() => useListedPages(modules(true, [logs]))).unmount()
    const { result, rerender } = renderHook(({ mounted }) => useListedPages(mounted), { initialProps: { mounted: modules(false) } })
    expect(result.current).toEqual([logs])
    rerender({ mounted: modules(true, [{ segment: 'queue', label: 'Queue', projects: ['p1'] }]) })
    expect(result.current.map(page => page.segment)).toEqual(['queue'])
  })

  test('with nothing kept, none until the modules are imported', () => {
    const { result } = renderHook(() => useListedPages(modules(false)))
    expect(result.current).toEqual([])
  })
})

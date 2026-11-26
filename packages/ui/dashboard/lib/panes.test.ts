import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { closePanes, forgetPanes, paneSizes, paneSizesOwner, panesPage, setActivePane, setActivityShown, setPaneOpen, setPaneSizes, setPanelExpanded, setPanelShown, useActivePane, useActivityShown, useOpenPanes, usePanelExpanded, usePanelShown } from './panes.js'

beforeEach(() => forgetPanes())

const kept = () => JSON.parse(localStorage.getItem('oa.panes')!) as { pages: Record<string, { open: string[]; active?: string; shown?: boolean; sizes: Record<string, Record<string, number>> }>; last: Record<string, Record<string, number>> }

test('an agent\'s page has its own panes, and the "New agent session" page one set for every project', () => {
  expect(panesPage('p1', 'r1')).toBe('p1/r1')
  expect(panesPage('p1', null)).toBe('new')
  expect(panesPage('p2', undefined)).toBe('new')
})

describe('the tabs of a page', () => {
  test('stand in the order they were opened; one opened again stays where it is, and is the one shown', () => {
    const { result } = renderHook(() => ({ open: useOpenPanes('p1/r1'), active: useActivePane('p1/r1'), shown: usePanelShown('p1/r1') }))
    expect(result.current).toEqual({ open: [], active: undefined, shown: false })
    act(() => setPaneOpen('p1/r1', 'files', true))
    act(() => setPaneOpen('p1/r1', 'changes', true))
    expect(result.current).toEqual({ open: ['files', 'changes'], active: 'changes', shown: true })
    act(() => setPaneOpen('p1/r1', 'files', true))
    expect(result.current).toEqual({ open: ['files', 'changes'], active: 'files', shown: true })
    act(() => setActivePane('p1/r1', 'changes'))
    expect(result.current.active).toBe('changes')
    // A tab that is not open is not shown.
    act(() => setActivePane('p1/r1', 'browser'))
    expect(result.current.active).toBe('changes')
  })

  test('a tab closed that was shown hands its place to the one before it, else after it; the last one closed leaves the panel open on its list', () => {
    const { result } = renderHook(() => ({ open: useOpenPanes('p1/r1'), active: useActivePane('p1/r1'), shown: usePanelShown('p1/r1') }))
    for (const id of ['files', 'changes', 'browser']) act(() => setPaneOpen('p1/r1', id, true))
    act(() => setActivePane('p1/r1', 'changes'))
    act(() => setPaneOpen('p1/r1', 'changes', false))
    expect(result.current).toEqual({ open: ['files', 'browser'], active: 'files', shown: true })
    act(() => setPaneOpen('p1/r1', 'files', false))
    expect(result.current.active).toBe('browser')
    // One not shown closes alone.
    act(() => setPaneOpen('p1/r1', 'files', true))
    act(() => setPaneOpen('p1/r1', 'browser', false))
    expect(result.current).toEqual({ open: ['files'], active: 'files', shown: true })
    act(() => setPaneOpen('p1/r1', 'files', false))
    expect(result.current).toEqual({ open: [], active: undefined, shown: true })
  })

  test('the panel closes and opens again on the tabs it had', () => {
    const { result } = renderHook(() => ({ open: useOpenPanes('p1/r1'), shown: usePanelShown('p1/r1') }))
    act(() => setPaneOpen('p1/r1', 'files', true))
    act(() => setPanelShown('p1/r1', false))
    expect(result.current).toEqual({ open: ['files'], shown: false })
    act(() => setPanelShown('p1/r1', true))
    expect(result.current).toEqual({ open: ['files'], shown: true })
  })

  test('are that page\'s alone, and are remembered in the browser; a page with the panel closed and no tab is not kept', () => {
    const { result } = renderHook(() => ({ here: useOpenPanes('p1/r1'), there: useOpenPanes('p1/r2') }))
    act(() => setPaneOpen('p1/r1', 'files', true))
    expect(result.current).toEqual({ here: ['files'], there: [] })
    expect(kept().pages['p1/r1']).toEqual({ open: ['files'], active: 'files', shown: true, sizes: {} })
    act(() => closePanes('p1/r1'))
    expect(kept().pages['p1/r1']!.shown).toBe(false)
    act(() => setPaneOpen('p1/r1', 'files', false))
    expect(kept().pages).toEqual({})
  })

  test('the same answer is the same list until something changes: a reader is not told of nothing', () => {
    const { result } = renderHook(() => useOpenPanes('p1/r1'))
    act(() => setPaneOpen('p1/r1', 'files', true))
    const first = result.current
    act(() => setPanelExpanded('p1/r1', true))
    expect(result.current).toBe(first)
  })

  test('only the last 200 pages are kept', () => {
    for (let i = 0; i <= 200; i++) setPaneOpen(`p/${i}`, 'files', true)
    const names = Object.keys(kept().pages)
    expect(names).toHaveLength(200)
    expect(names[0]).toBe('p/1')
    expect(names.at(-1)).toBe('p/200')
    // A page touched again is the newest: it outlives the pages after it.
    setPaneOpen('p/1', 'changes', true)
    setPaneOpen('p/201', 'files', true)
    expect(Object.keys(kept().pages)).toContain('p/1')
    expect(Object.keys(kept().pages)).not.toContain('p/2')
  })

  test('what the browser holds that is no such record is as if nothing was kept', () => {
    for (const junk of ['open', '["p1/r1"]', '{"pages":{"p1/r1":{"open":"files"}},"last":7}', '{"pages":{"p1/r1":{"open":[1,"files"],"sizes":{"workspace":{"chat":"wide"}}}}}']) {
      localStorage.setItem('oa.panes', junk)
      const { result, unmount } = renderHook(() => useOpenPanes('p1/r1'))
      expect(result.current.filter(id => typeof id !== 'string')).toEqual([])
      expect(paneSizes('p1/r1', 'workspace')).toBeUndefined()
      unmount()
    }
    setPaneOpen('p1/r1', 'files', true)
    expect(kept().pages['p1/r1']!.open).toEqual(['files'])
  })

  test('a browser that refused to keep them once shows them still, and goes on with what it keeps after', () => {
    const { result } = renderHook(() => useOpenPanes('p1/r1'))
    const refused = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('full')
    })
    act(() => setPaneOpen('p1/r1', 'files', true))
    expect(result.current).toEqual(['files'])
    act(() => setPaneOpen('p1/r1', 'changes', true))
    expect(result.current).toEqual(['files', 'changes'])
    act(() => setPaneOpen('p1/r1', 'files', false))
    expect(result.current).toEqual(['changes'])
    refused.mockRestore()
  })
})

describe('how a page\'s room is shared', () => {
  test('a page keeps the shares set on it; a page never sized starts with the last set on any', () => {
    expect(paneSizes('p1/r1', 'workspace')).toBeUndefined()
    setPaneSizes('p1/r1', 'workspace', { chat: 40, panes: 60 })
    expect(paneSizes('p1/r1', 'workspace')).toEqual({ chat: 40, panes: 60 })
    // Another page, and the "New agent session" page: the last shares set anywhere.
    expect(paneSizes('p1/r2', 'workspace')).toEqual({ chat: 40, panes: 60 })
    expect(paneSizes('new', 'workspace')).toEqual({ chat: 40, panes: 60 })
    setPaneSizes('p1/r2', 'workspace', { chat: 70, panes: 30 })
    expect(paneSizes('p1/r1', 'workspace')).toEqual({ chat: 40, panes: 60 })
    expect(paneSizes('p1/r2', 'workspace')).toEqual({ chat: 70, panes: 30 })
    expect(paneSizes('new', 'workspace')).toEqual({ chat: 70, panes: 30 })
  })

  test('whose shares a page has is a name: its own once it has some, else the last set anywhere, another name each time shares are set', () => {
    const none = paneSizesOwner('p1/r1', 'workspace')
    expect(paneSizesOwner('p1/r2', 'workspace')).toBe(none)
    setPaneSizes('p1/r1', 'workspace', { chat: 40, panes: 60 })
    expect(paneSizesOwner('p1/r1', 'workspace')).toBe('p1/r1')
    // Another group of the same page is not sized by it.
    expect(paneSizesOwner('p1/r1', 'files+changes')).not.toBe('p1/r1')
    const last = paneSizesOwner('p1/r2', 'workspace')
    expect(last).not.toBe(none)
    expect(paneSizesOwner('new', 'workspace')).toBe(last)
    setPaneSizes('p1/r1', 'workspace', { chat: 30, panes: 70 })
    expect(paneSizesOwner('p1/r2', 'workspace')).not.toBe(last)
  })

  test('a page sized keeps its shares with the panel closed and no tab', () => {
    setPaneSizes('p1/r1', 'workspace', { chat: 40, panes: 60 })
    setPaneOpen('p1/r1', 'files', true)
    setPaneOpen('p1/r1', 'files', false)
    closePanes('p1/r1')
    expect(kept().pages['p1/r1']).toEqual({ open: [], shown: false, sizes: { workspace: { chat: 40, panes: 60 } } })
  })
})

describe('the panel that fills a page', () => {
  test('is that page\'s, for the page\'s life, and fills it no more once the panel closes', () => {
    const { result } = renderHook(() => ({ here: usePanelExpanded('p1/r1'), there: usePanelExpanded('p1/r2') }))
    act(() => setPaneOpen('p1/r1', 'files', true))
    act(() => setPanelExpanded('p1/r1', true))
    expect(result.current).toEqual({ here: true, there: false })
    expect(localStorage.getItem('oa.panes')).not.toContain('expanded')
    act(() => setPanelExpanded('p1/r1', false))
    expect(result.current.here).toBe(false)
    act(() => setPanelExpanded('p1/r1', true))
    act(() => setPanelShown('p1/r1', false))
    expect(result.current.here).toBe(false)
  })
})

describe('the Activity panel', () => {
  test('stands beside the chat until it is put away, on every page, and the browser remembers it', () => {
    const { result } = renderHook(() => useActivityShown())
    expect(result.current).toBe(true)
    act(() => setActivityShown(false))
    expect(result.current).toBe(false)
    expect(localStorage.getItem('oa.activity')).toBe('0')
    act(() => setActivityShown(true))
    expect(result.current).toBe(true)
  })
})

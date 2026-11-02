import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { closePanes, forgetPanes, paneSizes, paneSizesOwner, panesPage, setExpandedPane, setPaneOpen, setPaneSizes, useExpandedPane, useOpenPanes } from './panes.js'

beforeEach(() => forgetPanes())

const kept = () => JSON.parse(localStorage.getItem('oa.panes')!) as { pages: Record<string, { open: string[]; sizes: Record<string, Record<string, number>> }>; last: Record<string, Record<string, number>> }

test('an agent\'s page has its own panes, and the "New agent" page one set for every project', () => {
  expect(panesPage('p1', 'r1')).toBe('p1/r1')
  expect(panesPage('p1', null)).toBe('new')
  expect(panesPage('p2', undefined)).toBe('new')
})

describe('the open panes of a page', () => {
  test('stand in the order they were opened; one closed and opened again is the last', () => {
    const { result } = renderHook(() => useOpenPanes('p1/r1'))
    expect(result.current).toEqual([])
    act(() => setPaneOpen('p1/r1', 'files', true))
    act(() => setPaneOpen('p1/r1', 'changes', true))
    expect(result.current).toEqual(['files', 'changes'])
    // Opened again while open: it stays where it is.
    act(() => setPaneOpen('p1/r1', 'files', true))
    expect(result.current).toEqual(['files', 'changes'])
    act(() => setPaneOpen('p1/r1', 'files', false))
    act(() => setPaneOpen('p1/r1', 'files', true))
    expect(result.current).toEqual(['changes', 'files'])
  })

  test('are that page\'s alone, are remembered in the browser, and all close at once', () => {
    const { result } = renderHook(() => ({ here: useOpenPanes('p1/r1'), there: useOpenPanes('p1/r2') }))
    act(() => setPaneOpen('p1/r1', 'files', true))
    expect(result.current).toEqual({ here: ['files'], there: [] })
    expect(kept().pages['p1/r1']!.open).toEqual(['files'])
    act(() => closePanes('p1/r1'))
    expect(result.current.here).toEqual([])
    // A page with nothing open and nothing sized is not kept.
    expect(kept().pages).toEqual({})
  })

  test('the same answer is the same list until something changes: a reader is not told of nothing', () => {
    const { result } = renderHook(() => useOpenPanes('p1/r1'))
    act(() => setPaneOpen('p1/r1', 'files', true))
    const first = result.current
    act(() => setExpandedPane('p1/r1', 'files'))
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
    // Another page, and the "New agent" page: the last shares set anywhere.
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

  test('each group has its own shares, and a page sized keeps them with every pane closed', () => {
    setPaneSizes('p1/r1', 'files+changes', { files: 67, changes: 33 })
    expect(paneSizes('p1/r1', 'workspace')).toBeUndefined()
    setPaneOpen('p1/r1', 'files', true)
    closePanes('p1/r1')
    expect(paneSizes('p1/r1', 'files+changes')).toEqual({ files: 67, changes: 33 })
    expect(kept().pages['p1/r1']).toEqual({ open: [], sizes: { 'files+changes': { files: 67, changes: 33 } } })
  })
})

describe('the pane that fills a page', () => {
  test('is that page\'s, for the page\'s life, and none once it is closed', () => {
    const { result } = renderHook(() => ({ here: useExpandedPane('p1/r1'), there: useExpandedPane('p1/r2') }))
    act(() => setPaneOpen('p1/r1', 'files', true))
    act(() => setExpandedPane('p1/r1', 'files'))
    expect(result.current).toEqual({ here: 'files', there: undefined })
    expect(localStorage.getItem('oa.panes')).not.toContain('expanded')
    act(() => setExpandedPane('p1/r1', undefined))
    expect(result.current.here).toBeUndefined()
    act(() => setExpandedPane('p1/r1', 'files'))
    act(() => setPaneOpen('p1/r1', 'files', false))
    expect(result.current.here).toBeUndefined()
  })
})

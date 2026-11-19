import { afterEach, describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { blockRender, blocksShownElsewhere, mountedOf, renderFor, useListedPages, withoutBlocks, type MountedModules } from './use-modules.js'
import { SESSIONS_ID } from '../../src/project-address.js'

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

describe('how a kind of content looks, as the modules draw it', () => {
  const Card = () => null
  const Diagram = () => null
  const mounted = mountedOf({
    renders: [
      { kind: 'question', Render: Card, package: 'ask', projects: ['p1'], sessions: true },
      { kind: 'question', Render: () => null, package: 'another-ask', projects: ['p1', 'p2'] },
      { kind: 'await-choices', package: 'ask', projects: ['p1'] },
      { kind: 'mermaid', Render: Diagram, package: 'mermaid', projects: ['p2'] },
    ],
  })

  test("a question is drawn by the first module on in the run's project that draws one; a session with no project's, by one on for those sessions", () => {
    expect(renderFor(mounted, 'question', 'p1')?.package).toBe('ask')
    expect(renderFor(mounted, 'question', 'p2')?.package).toBe('another-ask')
    expect(renderFor(mounted, 'question', 'p3')).toBeUndefined()
    expect(renderFor(mounted, 'question', SESSIONS_ID)?.Render).toBe(Card)
  })

  test('a fenced block is drawn by the module that names its language; one it shows elsewhere, and one nothing names, are code', () => {
    expect(blockRender(mounted, 'mermaid')?.Render).toBe(Diagram)
    expect(blockRender(mounted, 'await-choices')).toMatchObject({ package: 'ask' })
    expect(blockRender(mounted, 'await-choices')?.Render).toBeUndefined()
    // A block fenced as a kind drawn from props is code: no text draws a question's card.
    expect(blockRender(mounted, 'question')).toBeUndefined()
    expect(blockRender(mounted, 'ts')).toBeUndefined()
    expect(blocksShownElsewhere(mounted)).toEqual(['await-choices'])
  })

  test('a text without the blocks shown elsewhere: closed ones, and one still being written', () => {
    const block = '```await-choices\n{ "title": "Which?" }\n```'
    expect(withoutBlocks(`a\n${block}\nb`, ['await-choices'])).toBe('a\n\nb')
    expect(withoutBlocks('Pick one.\n\n```await-choices\n{ "title": "Whi', ['await-choices'])).toBe('Pick one.')
    // Another language's block stays, and nothing is left out where no module shows one elsewhere.
    expect(withoutBlocks('```ts\nx\n```', ['await-choices'])).toBe('```ts\nx\n```')
    expect(withoutBlocks(` ${block} `, [])).toBe(block)
  })
})

import { afterEach, describe, expect, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { forgetRevealedChanges, revealChange, revealScreen, useRevealedChange, useRevealedScreen } from './reveal-change.js'

afterEach(() => forgetRevealedChanges())

describe('revealChange', () => {
  test('an ask is the file its page\'s pane is handed; no ask, no file', () => {
    const { result } = renderHook(() => useRevealedChange('p1/r1'))
    expect(result.current).toBeUndefined()
    act(() => revealChange('p1/r1', 'src/app.ts'))
    expect(result.current?.path).toBe('src/app.ts')
  })

  test('a second ask for the same file is a new ask; another page\'s ask is not this page\'s', () => {
    const { result } = renderHook(() => useRevealedChange('p1/r1'))
    act(() => revealChange('p1/r1', 'src/app.ts'))
    const first = result.current!.at
    act(() => revealChange('p1/r1', 'src/app.ts'))
    expect(result.current!.at).toBeGreaterThan(first)
    act(() => revealChange('p1/other', 'README.md'))
    expect(result.current!.path).toBe('src/app.ts')
  })

  test('an ask with no file is an ask for all of them: a new ask, with no path', () => {
    const { result } = renderHook(() => useRevealedChange('p1/r1'))
    act(() => revealChange('p1/r1', 'src/app.ts'))
    const first = result.current!.at
    act(() => revealChange('p1/r1'))
    expect(result.current!.at).toBeGreaterThan(first)
    expect(result.current).not.toHaveProperty('path')
  })
})

describe('revealScreen', () => {
  test('each ask for a page\'s live screen is a new one, and another page\'s is not this page\'s', () => {
    const { result } = renderHook(() => useRevealedScreen('p1/r1'))
    expect(result.current).toBeUndefined()
    act(() => revealScreen('p1/r1'))
    const first = result.current!
    act(() => revealScreen('p1/other'))
    expect(result.current).toBe(first)
    act(() => revealScreen('p1/r1'))
    expect(result.current).toBeGreaterThan(first)
  })
})

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSkeleton } from './skeleton.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => (cleanup(), vi.useRealTimers()))

describe('useSkeleton', () => {
  test('an answer within 200ms draws no skeleton after it', () => {
    const { result, rerender } = renderHook(({ waiting }) => useSkeleton(waiting), { initialProps: { waiting: true } })
    expect(result.current).toBe(true)
    act(() => vi.advanceTimersByTime(150))
    rerender({ waiting: false })
    expect(result.current).toBe(false)
  })

  test('a skeleton that has shown stays 300ms, however soon the answer comes', () => {
    const { result, rerender } = renderHook(({ waiting }) => useSkeleton(waiting), { initialProps: { waiting: true } })
    act(() => vi.advanceTimersByTime(250))
    rerender({ waiting: false })
    expect(result.current).toBe(true)
    act(() => vi.advanceTimersByTime(240))
    expect(result.current).toBe(true)
    act(() => vi.advanceTimersByTime(20))
    expect(result.current).toBe(false)
  })

  test('a skeleton shown longer than 300ms goes with the answer', () => {
    const { result, rerender } = renderHook(({ waiting }) => useSkeleton(waiting), { initialProps: { waiting: true } })
    act(() => vi.advanceTimersByTime(1000))
    rerender({ waiting: false })
    expect(result.current).toBe(false)
  })
})

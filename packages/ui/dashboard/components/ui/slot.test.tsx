import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReadState } from '../../lib/use-async.js'
import { Slot } from './slot.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => (cleanup(), vi.useRealTimers()))

const SHAPE = <div data-testid="shape" className="animate-skeleton" />
const slot = (state: ReadState, value: string, extra: { failing?: boolean; hold?: boolean } = {}) => (
  <Slot of={{ state, value, ...(extra.failing ? { failing: true } : {}) }} shape={SHAPE} {...(extra.hold ? { hold: true } : {})}>
    {answer => <p>{`answer ${answer}`}</p>}
  </Slot>
)

describe('Slot', () => {
  test('a wait draws the shape and never the value held before an answer', () => {
    render(slot('unknown', 'none'))
    expect(screen.getByTestId('shape')).not.toBeNull()
    expect(screen.queryByText('answer none')).toBeNull()
  })

  test('an answer within 200ms draws no mark after it', () => {
    const { rerender } = render(slot('unknown', ''))
    act(() => vi.advanceTimersByTime(150))
    rerender(slot('fresh', 'a'))
    expect(screen.queryByTestId('shape')).toBeNull()
    expect(screen.getByText('answer a')).not.toBeNull()
  })

  test('a mark that has shown stays 300ms, however soon the answer comes', () => {
    const { rerender } = render(slot('unknown', ''))
    act(() => vi.advanceTimersByTime(250))
    rerender(slot('fresh', 'a'))
    expect(screen.getByTestId('shape')).not.toBeNull()
    act(() => vi.advanceTimersByTime(240))
    expect(screen.queryByText('answer a')).toBeNull()
    act(() => vi.advanceTimersByTime(20))
    expect(screen.getByText('answer a')).not.toBeNull()
  })

  test('a kept answer is drawn at once, and marked old once a second has passed without the fresh one', () => {
    const { container, rerender } = render(slot('kept', 'a'))
    expect(screen.getByText('answer a')).not.toBeNull()
    expect(container.querySelector('[data-stale]')).toBeNull()
    act(() => vi.advanceTimersByTime(1000))
    expect(container.querySelector('[data-stale]')).not.toBeNull()
    rerender(slot('fresh', 'b'))
    expect(container.querySelector('[data-stale]')).toBeNull()
  })

  test('a failing read keeps its answer, with a note that takes no room', () => {
    const { rerender } = render(slot('fresh', 'a'))
    rerender(slot('fresh', 'a', { failing: true }))
    expect(screen.getByText('answer a')).not.toBeNull()
    expect(screen.getByText('Not up to date').className).toContain('absolute')
  })

  test('held, a change of subject keeps the last answer in place, dimmed, until the new one lands', () => {
    const { rerender } = render(slot('fresh', 'a', { hold: true }))
    rerender(slot('unknown', '', { hold: true }))
    expect(screen.queryByTestId('shape')).toBeNull()
    expect(screen.getByText('answer a').parentElement?.className).toContain('opacity-60')
    act(() => vi.advanceTimersByTime(1000))
    rerender(slot('fresh', 'b', { hold: true }))
    expect(screen.getByText('answer b').parentElement?.className).not.toContain('opacity-60')
    expect(screen.queryByText('answer a')).toBeNull()
  })
})

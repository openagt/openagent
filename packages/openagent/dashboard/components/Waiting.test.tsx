import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Waiting } from './Waiting.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('the line keeps its room unseen while the read is quick, and shows once it takes a moment', () => {
  render(<Waiting>Reading the file…</Waiting>)
  const line = screen.getByText('Reading the file…')
  expect(line.className).toContain('invisible')
  act(() => void vi.advanceTimersByTime(499))
  expect(line.className).toContain('invisible')
  act(() => void vi.advanceTimersByTime(1))
  expect(line.className).not.toContain('invisible')
})

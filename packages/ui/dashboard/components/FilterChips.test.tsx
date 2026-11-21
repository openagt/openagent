import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FilterChips } from './FilterChips.js'

afterEach(cleanup)

const chips = [
  { value: 'done', label: 'Done', count: 3 },
  { value: 'failed', label: 'Failed', count: 1 },
]

test('All and one chip per value with its count; the picked one pressed; a press picks, All picks none', () => {
  const onPick = vi.fn()
  render(<FilterChips chips={chips} total={4} picked="failed" onPick={onPick} />)
  const buttons = screen.getAllByRole('button')
  expect(buttons.map(button => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([
    ['All4', 'false'],
    ['Done3', 'false'],
    ['Failed1', 'true'],
  ])
  fireEvent.click(screen.getByRole('button', { name: /^Done/ }))
  fireEvent.click(screen.getByRole('button', { name: /^All/ }))
  expect(onPick.mock.calls).toEqual([['done'], [null]])
})

test('one value alone has no chips: a single chip would pick nothing', () => {
  render(<FilterChips chips={chips.slice(0, 1)} total={3} picked={null} onPick={() => {}} />)
  expect(screen.queryByRole('group')).toBeNull()
})

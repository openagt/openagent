import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SubagentRow } from '../lib/subagents.js'

vi.mock('../rpc/agents.js', () => ({ onCodingAgents: () => new Promise(() => {}), onNamesRuns: () => new Promise(() => {}) }))
const { SubagentSteps } = await import('./SubagentLine.js')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const working = (key: string, name: string): SubagentRow => ({ key, name, status: 'running', working: true, startedAt: '2026-10-01T10:00:00.000Z', call: { id: key, status: 'working', calls: 0 } })

test('the folded line of working subagents is never its chevron alone: a name that leaves stays, unsaid, until the next one is readable', () => {
  vi.useFakeTimers()
  render(<SubagentSteps steps={[{ kind: 'agent', row: working('a', 'Map the pages') }, { kind: 'agent', row: working('b', 'Read the theme tokens') }]} />)
  const line = screen.getByRole('button', { name: 'Working: Map the pages' })
  // Its first name comes with the line, at once.
  expect(line.querySelector('.morph-in')).toBeNull()
  expect(line.textContent).toBe('Map the pages')
  act(() => vi.advanceTimersByTime(2500))
  expect(line.getAttribute('aria-label')).toBe('Working: Read the theme tokens')
  const left = screen.getByText('Map the pages').parentElement!
  expect([left.getAttribute('aria-hidden'), left.className.includes('morph-out')]).toEqual(['true', true])
  expect(screen.getByText('Read the theme tokens').parentElement!.className).toContain('morph-in')
  // jsdom has no AnimationEvent, so React listens for the end under its prefixed name.
  fireEvent(left, new Event('webkitAnimationEnd', { bubbles: true }))
  expect(line.textContent).toBe('Read the theme tokens')
})

test("a working name's shimmer is on its words, its arrival on their box, so neither animation takes the other's place", () => {
  vi.useFakeTimers()
  render(<SubagentSteps steps={[{ kind: 'agent', row: working('a', 'Map the pages') }, { kind: 'agent', row: working('b', 'Read the theme tokens') }]} />)
  act(() => vi.advanceTimersByTime(2500))
  const words = screen.getByText('Read the theme tokens')
  expect([words.className, words.parentElement!.className.includes('text-shimmer')]).toEqual(['text-shimmer', false])
})

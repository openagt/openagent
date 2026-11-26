import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

const { BackgroundTasksPane, lasted } = await import('./BackgroundTasksPane.js')

afterEach(cleanup)

test('what runs in the background, each with how long it has gone on, then the subagents', () => {
  const since = new Date(Date.now() - 72_000).toISOString()
  render(<BackgroundTasksPane background={[{ id: 't1', description: 'Run the tests', command: 'pnpm test', since }]} subagents={<p>the subagents</p>} />)
  const commands = screen.getByRole('region', { name: 'Background commands' })
  expect(within(commands).getByText('Running 1')).toBeTruthy()
  expect(within(commands).getByText('Run the tests')).toBeTruthy()
  expect(within(commands).getByText('pnpm test')).toBeTruthy()
  expect(within(commands).getByText('1m 12s')).toBeTruthy()
  expect(screen.getByText('the subagents')).toBeTruthy()
})

test('with nothing in the background, only the subagents', () => {
  render(<BackgroundTasksPane background={[]} subagents={<p>the subagents</p>} />)
  expect(screen.queryByRole('region', { name: 'Background commands' })).toBeNull()
})

test('a time said short: seconds, minutes and seconds, hours and minutes', () => {
  expect([lasted(34_000), lasted(72_000), lasted(7_500_000)]).toEqual(['34s', '1m 12s', '2h 5m'])
})

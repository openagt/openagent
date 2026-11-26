import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const stopTask = vi.fn(async (..._args: unknown[]) => ({ ok: true }))
vi.mock('../rpc/control.js', () => ({ stopTask }))

const { BackgroundTasksPane, lasted } = await import('./BackgroundTasksPane.js')

afterEach(cleanup)

test('what runs in the background, each with how long it has gone on, then the subagents', () => {
  const since = new Date(Date.now() - 72_000).toISOString()
  render(<BackgroundTasksPane projectId="p1" agentId="r1" background={[{ id: 't1', description: 'Run the tests', command: 'pnpm test', since }]} subagents={<p>the subagents</p>} />)
  const commands = screen.getByRole('region', { name: 'Background commands' })
  expect(within(commands).getByText('Running 1')).toBeTruthy()
  expect(within(commands).getByText('Run the tests')).toBeTruthy()
  expect(within(commands).getByText('pnpm test')).toBeTruthy()
  expect(within(commands).getByText('1m 12s')).toBeTruthy()
  expect(screen.getByText('the subagents')).toBeTruthy()
})

test('with nothing in the background, only the subagents', () => {
  render(<BackgroundTasksPane projectId="p1" agentId="r1" background={[]} subagents={<p>the subagents</p>} />)
  expect(screen.queryByRole('region', { name: 'Background commands' })).toBeNull()
})

test('a time said short: seconds, minutes and seconds, hours and minutes', () => {
  expect([lasted(34_000), lasted(72_000), lasted(7_500_000)]).toEqual(['34s', '1m 12s', '2h 5m'])
})

test("each command's ■ stops that one, and spins until the command is gone", async () => {
  render(<BackgroundTasksPane projectId="p1" agentId="r1" background={[{ id: 'b6pgvzpj0', description: 'Run the dev server', command: 'pnpm dev', since: new Date().toISOString() }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Stop Run the dev server' }))
  expect(stopTask).toHaveBeenCalledWith('p1', 'r1', 'b6pgvzpj0')
  expect(await screen.findByRole('button', { name: 'Stopping Run the dev server' })).toBeTruthy()
})

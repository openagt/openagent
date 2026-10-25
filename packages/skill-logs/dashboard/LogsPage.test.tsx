import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ModuleHostContext, type ModuleHost } from '@openagt/dashboard/module'
import { LogsPage, dayOf } from './LogsPage.js'

// The Logs page: every run of the projects shown, newest first, in one table cut by day, each day
// with how many runs it had and what they cost; chips pick one status.

const HOUR = 60 * 60_000
const at = (ms: number) => new Date(ms).toISOString()
const now = Date.now()
const noon = new Date(new Date().setHours(12, 0, 0, 0)).getTime()

function hostWith(cards: unknown[]): ModuleHost {
  return {
    package: '@openagt/skill-logs',
    runCommand: vi.fn(async () => ({ ok: true as const, output: cards })),
    openAgent: vi.fn(),
  } as unknown as ModuleHost
}

afterEach(cleanup)

test('a day is said as Today, Yesterday, else its weekday and date', () => {
  const today = new Date('2026-10-25T15:00:00')
  expect(dayOf('2026-10-25T01:00:00', today)).toBe('Today')
  expect(dayOf('2026-10-24T23:00:00', today)).toBe('Yesterday')
  // In the browser's own language: the weekday, the month and the day.
  expect(dayOf('2026-10-21T10:00:00', today)).toBe(new Date('2026-10-21T10:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))
})

test('the runs cut by day, each day with its runs and their cost; a run by its name over what it was asked, how long it took; a chip shows one status', async () => {
  const host = hostWith([
    { id: 'r1', startedAt: at(now - 1000), endedAt: at(now), status: 'done', title: 'Login page', intent: 'make the login page', cost: 0.5 },
    { id: 'r2', startedAt: at(now - 2000), status: 'failed', intent: 'break it', cost: 0.25 },
    { id: 'r3', startedAt: at(noon - 24 * HOUR), endedAt: at(noon - 24 * HOUR + 120_000), status: 'done', intent: 'yesterday work', cost: 1 },
  ])
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const today = (await screen.findAllByText('Today'))[0]!.closest('h2')!
  expect(today.textContent).toBe('Today2 runs · $0.75')
  expect(screen.getAllByText('Yesterday')[0]!.closest('h2')!.textContent).toBe('Yesterday1 run · $1.00')
  // Its name, over what it was asked; a run with no name is its ask.
  const login = screen.getAllByText('Login page')[0]!.closest('tr')!
  expect(within(login).getByText('make the login page')).toBeTruthy()
  expect(screen.getAllByText('yesterday work')[0]!.closest('tr')!.textContent).toContain('2m')
  // A chip per status the runs have, each with its count.
  fireEvent.click(screen.getByRole('button', { name: /^Failed/ }))
  expect(screen.queryAllByText('Login page')).toHaveLength(0)
  expect(screen.getAllByText('break it').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: /^All/ }))
  expect(screen.getAllByText('Login page').length).toBeGreaterThan(0)
  // A row opens its run.
  fireEvent.click(screen.getAllByText('Login page')[0]!.closest('tr')!)
  expect(host.openAgent).toHaveBeenCalledWith('p1', 'r1')
})

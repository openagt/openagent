import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModuleHostContext, forgetRemembered, type ModuleAgent } from '@openagt/dashboard/module'
import { fakeHost, type FakeHost } from '@openagt/dashboard/module/testing'
import { LogsPage, dayOf } from './LogsPage.js'

// The Logs page: every run of the projects shown, newest first, in one table cut by day, each day
// with how many runs it had and what they cost; chips pick one status.

const HOUR = 60 * 60_000
const at = (ms: number) => new Date(ms).toISOString()
const now = Date.now()
const noon = new Date(new Date().setHours(12, 0, 0, 0)).getTime()

/** A host whose `logs` prints `cards`, and whose dashboard lists `runs` right now. */
function hostWith(cards: unknown[], runs: unknown[] = []): FakeHost {
  return fakeHost('@openagt/skill-logs', { runCommand: async () => ({ ok: true as const, output: cards }), agents: async () => runs as ModuleAgent[] })
}

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
})

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

test('each run as the dashboard says it stands: a record that still says running reads unknown while its computer is offline, and a run with no record yet is listed', async () => {
  const seenAt = at(now - HOUR)
  const host = hostWith(
    // The records froze while the laptop worked on.
    [{ id: 'r1', startedAt: at(now - 5000), status: 'running', intent: 'frozen in the records' }],
    [
      { id: 'r1', startedAt: at(now - 5000), status: 'unknown', ask: 'frozen in the records', machine: 'MacBook', seenAt },
      { id: 'r2', startedAt: at(now - 1000), endedAt: at(now), status: 'done', title: 'Only on the laptop', cost: 0.3 },
    ],
  )
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const added = (await screen.findAllByText('Only on the laptop'))[0]!.closest('tr')!
  expect(added.textContent).toContain('done')
  const frozen = screen.getAllByText('frozen in the records')[0]!.closest('tr')!
  expect(within(frozen).getByText('status unknown').closest('[title]')!.getAttribute('title')).toBe(`MacBook offline · last seen ${new Date(seenAt).toLocaleString()}`)
  expect(screen.queryAllByText('running')).toHaveLength(0)
})

test("each run says whose it is: their picture where the project's git host knows them, else two letters; a very old card has no mark, and its name stays in line", async () => {
  const host = hostWith(
    [
      { id: 'r1', startedAt: at(now - 1000), status: 'done', title: 'Hers', person: 'ada@x.dev' },
      { id: 'r2', startedAt: at(now - 2000), status: 'done', title: 'His', person: 'git@brillout.com' },
      { id: 'r3', startedAt: at(now - 3000), status: 'done', title: 'Very old' },
    ],
    // A run with no record yet says whose it is too.
    [{ id: 'r4', startedAt: at(now - 500), status: 'running', title: 'Going', person: 'ada@x.dev' }],
  )
  vi.mocked(host.gitHostPeople).mockImplementation(async () => [{ email: 'ada@x.dev', login: 'ada', avatar: 'https://avatars.githubusercontent.com/u/1' }])
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const row = (title: string) => screen.getAllByText(title)[0]!.closest('tr')!
  await waitFor(() => expect(within(row('Hers')).getByRole('img', { name: 'ada@x.dev · ada' }).querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1'))
  expect(within(row('Going')).getByRole('img', { name: 'ada@x.dev · ada' })).toBeTruthy()
  expect(within(row('His')).getByRole('img', { name: 'git@brillout.com' }).textContent).toBe('BR')
  expect(within(row('Very old')).queryByRole('img')).toBeNull()
  expect(row('Very old').querySelector('span.size-6')).toBeTruthy()
  // Each person once, however many runs are theirs; and not again when the page reads its runs again.
  expect(vi.mocked(host.gitHostPeople).mock.calls.at(-1)).toEqual(['p1', ['ada@x.dev', 'git@brillout.com']])
})

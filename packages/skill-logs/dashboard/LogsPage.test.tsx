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
  const page = (path: string[]) => (
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={path} />
    </ModuleHostContext.Provider>
  )
  const { rerender } = render(page([]))
  const today = (await screen.findAllByText('Today'))[0]!.closest('h2')!
  expect(today.textContent).toBe('Today2 runs · $0.75')
  expect(screen.getAllByText('Yesterday')[0]!.closest('h2')!.textContent).toBe('Yesterday1 run · $1.00')
  // Its name, over what it was asked; a run with no name is its ask.
  const login = screen.getAllByText('Login page')[0]!.closest('tr')!
  expect(within(login).getByText('make the login page')).toBeTruthy()
  expect(screen.getAllByText('yesterday work')[0]!.closest('tr')!.textContent).toContain('2m')
  // A chip per status the runs have, each with its count; its pick is kept in the page's address, in the place of the last one, so Back leaves the page.
  fireEvent.click(screen.getByRole('button', { name: /^Failed/ }))
  expect(host.openPage).toHaveBeenLastCalledWith('logs', ['failed'], undefined, { replace: true })
  rerender(page(['failed']))
  expect(screen.queryAllByText('Login page')).toHaveLength(0)
  expect(screen.getAllByText('break it').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: /^All/ }))
  expect(host.openPage).toHaveBeenLastCalledWith('logs', [], undefined, { replace: true })
  rerender(page([]))
  expect(screen.getAllByText('Login page').length).toBeGreaterThan(0)
  // A status no run has any more shows them all.
  rerender(page(['stopped']))
  expect(screen.getAllByText('Login page').length).toBeGreaterThan(0)
  // A row opens its run.
  fireEvent.click(screen.getAllByText('Login page')[0]!.closest('tr')!)
  expect(host.openAgent).toHaveBeenCalledWith('p1', 'r1')
})

test("a run's name is a link to the run: the keyboard reaches it, it opens the run once, on a phone too, and a Ctrl+click is the browser's", async () => {
  const host = hostWith([{ id: 'r1', startedAt: at(now - 1000), endedAt: at(now), status: 'done', title: 'Login page' }])
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const [table, phone] = await screen.findAllByRole('link', { name: 'Login page' })
  expect(table!.getAttribute('href')).toBe('/p1/r1')
  expect(fireEvent.click(table!, { ctrlKey: true })).toBe(true)
  expect(host.openAgent).not.toHaveBeenCalled()
  fireEvent.click(table!)
  expect(host.openAgent.mock.calls).toEqual([['p1', 'r1']])
  fireEvent.click(phone!)
  expect(host.openAgent.mock.calls).toEqual([
    ['p1', 'r1'],
    ['p1', 'r1'],
  ])
})

test("each status in the dashboard's colors: a waiting run's dot is the sidebar's amber, and one that ended is a ring", async () => {
  const host = hostWith([
    { id: 'r1', startedAt: at(now - 1000), status: 'waiting', title: 'Asks' },
    { id: 'r2', startedAt: at(now - 2000), endedAt: at(now - 1000), status: 'done', title: 'Ended' },
  ])
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const dot = (title: string) => within(screen.getAllByText(title)[0]!.closest('tr')!).getByText(/^(waiting|done)$/).querySelector('span')!.className
  await screen.findAllByText('Asks')
  expect(dot('Asks')).toContain('bg-warning')
  expect(dot('Ended')).toContain('border-muted-foreground/60')
})

test('a run waiting on a question took nothing yet: its end so far is only its last turn\'s', async () => {
  const host = hostWith([
    { id: 'r1', startedAt: at(now - 120_000), endedAt: at(now - 60_000), status: 'waiting', title: 'Asks' },
    { id: 'r2', startedAt: at(now - 240_000), endedAt: at(now - 120_000), status: 'stopped', title: 'Halted' },
  ])
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const took = (title: string) => (screen.getAllByText(title)[0]!.closest('tr')!.children[3] as HTMLElement).textContent
  await screen.findAllByText('Asks')
  expect(took('Asks')).toBe('—')
  expect(took('Halted')).toBe('2m')
})

test('a run goes by the name every list gives it: with no short name and no prompt, its branch; with none of these, its id', async () => {
  render(
    <ModuleHostContext.Provider value={hostWith([{ id: 'r1', startedAt: at(now - 1000), status: 'done', branch: 'agent-fix-header' }, { id: 'r2', startedAt: at(now - 2000), status: 'done' }])}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  expect((await screen.findAllByRole('link', { name: 'agent-fix-header' })).length).toBeGreaterThan(0)
  expect(screen.getAllByRole('link', { name: 'r2' }).length).toBeGreaterThan(0)
})

test('a second visit opens with the last list at once, while the runs are read again, faded once that read has been out a second', async () => {
  const page = (host: FakeHost) => (
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>
  )
  render(page(hostWith([{ id: 'r1', startedAt: at(now - 1000), endedAt: at(now), status: 'done', title: 'Login page' }])))
  await screen.findAllByText('Login page')
  cleanup()
  forgetRemembered()
  // The next visit, after a reload: the reads do not answer yet.
  render(page(fakeHost('@openagt/skill-logs', { runCommand: () => new Promise(() => {}), agents: () => new Promise(() => {}) })))
  expect(screen.getAllByText('Login page').length).toBeGreaterThan(0)
  expect(screen.queryByText('Loading…')).toBeNull()
  const row = screen.getAllByText('Login page')[0]!
  expect(row.closest('[data-stale]')).toBeNull()
  await waitFor(() => expect(row.closest('[data-stale]')).not.toBeNull(), { timeout: 2000 })
})

test('the runs the dashboard lists show while the records are still read, with no "Loading…" over them', async () => {
  const host = fakeHost('@openagt/skill-logs', {
    runCommand: () => new Promise(() => {}),
    agents: async () => [{ id: 'r1', startedAt: at(now - 1000), status: 'running', title: 'Going' }] as ModuleAgent[],
  })
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  expect(screen.getByText('Loading…')).toBeTruthy()
  await screen.findAllByText('Going')
  expect(screen.queryByText('Loading…')).toBeNull()
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

test('a project that gave the whole page of 50 runs has older ones: the page says it lists the last 50; one with fewer lists every run', async () => {
  const cards = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `r${index}`, startedAt: at(now - index * 1000), endedAt: at(now - index * 1000 + 500), status: 'done', intent: `run ${index}` }))
  const page = (host: FakeHost) => (
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>
  )
  render(page(hostWith(cards(50))))
  expect(await screen.findByText('The last 50 runs recorded in this project, newest first.')).toBeTruthy()
  cleanup()
  forgetRemembered()
  render(page(hostWith(cards(49))))
  expect(await screen.findByText('Every run recorded in this project, newest first.')).toBeTruthy()
  await screen.findAllByText('run 48')
  expect(screen.queryByText(/^The last 50 runs/)).toBeNull()
})

import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModuleHostContext, forgetRemembered, type ModuleAgent, type WaitingItem } from '@openagt/ui/module'
import { fakeHost, type FakeHost } from '@openagt/ui/module/testing'
import { LogsPage } from './LogsPage.js'

// What waits on the person as the shell read it for the sidebar's "Waiting on you", a test's: the page reads the shell's read.
const shell = vi.hoisted(() => ({ items: [] as WaitingItem[] }))
vi.mock('@openagt/ui/module', async original => ({
  ...(await original<typeof import('@openagt/ui/module')>()),
  useWaiting: () => ({ items: shell.items, state: 'fresh', all: { items: shell.items, whole: [] } }),
}))

// The Logs page: every run of the projects shown, newest first, in one list cut by day, each day
// with what its runs cost; a word over the list picks one status.

const HOUR = 60 * 60_000
const at = (ms: number) => new Date(ms).toISOString()
const now = Date.now()
const noon = new Date(new Date().setHours(12, 0, 0, 0)).getTime()

/** A host whose server part reads `cards`, and whose dashboard lists `runs` right now in a project, and `sessions` with no project. */
function hostWith(cards: unknown[], runs: unknown[] = [], sessions: unknown[] = []): FakeHost {
  return fakeHost('@openagt/logs', { call: async () => ({ ok: true as const, output: cards }), agents: async (projectId: string) => (projectId === 'session' ? sessions : runs) as ModuleAgent[] })
}

afterEach(() => {
  cleanup()
  shell.items = []
  forgetRemembered()
  localStorage.clear()
  // A test that opened the page at a pick's query leaves the next one at none.
  window.history.replaceState(null, '', '/')
})

test('a project with no run recorded says so where the runs would stand, and lists none', async () => {
  render(
    <ModuleHostContext.Provider value={hostWith([])}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  expect(await screen.findByText('No runs recorded yet. A run is listed here from the moment an agent starts on this project.')).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
})

test('with every project showing, the sessions with no project are listed too, as the dashboard lists them; with one project picked, they are not', async () => {
  const host = hostWith([{ id: 'r1', startedAt: at(now - 2000), endedAt: at(now), status: 'done', title: 'In the project' }], [], [{ id: 's1', startedAt: at(now - 1000), status: 'waiting', title: 'Greeting exchange' }])
  const page = (projectId: string | null) => (
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={projectId} path={[]} />
    </ModuleHostContext.Provider>
  )
  const every = render(page(null))
  expect(await screen.findByText('Greeting exchange')).toBeTruthy()
  expect(screen.getByText('In the project')).toBeTruthy()
  expect(screen.getByText('Every run recorded in alpha, and the sessions with no project, newest first.')).toBeTruthy()
  // Its row opens the session where its address is, under no project.
  expect(screen.getByText('Greeting exchange').closest('a')!.getAttribute('href')).toBe(host.agentHref('session', 's1'))
  every.unmount()
  forgetRemembered()
  localStorage.clear()
  render(page('p1'))
  expect(await screen.findByText('In the project')).toBeTruthy()
  expect(screen.queryByText('Greeting exchange')).toBeNull()
})

test('the runs cut by day, each day with what its runs cost; a run by its name, what it was asked under the pointer, how long it took; a chip shows one status', async () => {
  const host = hostWith([
    { id: 'r1', startedAt: at(now - 1000), endedAt: at(now), status: 'done', title: 'Login page', intent: 'make the login page', cost: 0.5 },
    { id: 'r2', startedAt: at(now - 2000), status: 'failed', intent: 'break it', cost: 0.25 },
    { id: 'r3', startedAt: at(noon - 24 * HOUR), endedAt: at(noon - 24 * HOUR + 120_000), status: 'done', intent: 'yesterday work', cost: 1 },
  ])
  const page = (
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>
  )
  const { unmount } = render(page)
  const today = (await screen.findAllByText('Today'))[0]!.closest('h2')!
  expect(today.textContent).toBe('Today $0.75')
  expect(screen.getAllByText('Yesterday')[0]!.closest('h2')!.textContent).toBe('Yesterday $1.00')
  // Its name, with what it was asked whole under the pointer; a run with no name is its ask.
  const login = screen.getAllByText('Login page')[0]!.closest('li')!
  expect(within(login).getByRole('link', { name: 'Login page' }).getAttribute('title')).toBe('make the login page')
  expect(screen.getAllByText('yesterday work')[0]!.closest('li')!.textContent).toContain('2m')
  // A word per status the runs have, each with its count; its pick is kept in the page's query, in the place of the last
  // one, so Back leaves the page, and the page's path names no page below it.
  // A status is one word on its chip and beside a run's dot.
  expect(within(screen.getAllByText('break it')[0]!.closest('li')!).getByText(/^Failed/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Failed/ }))
  expect(host.adjustPage).toHaveBeenLastCalledWith(undefined, 'status=failed')
  expect(screen.queryAllByText('Login page')).toHaveLength(0)
  expect(screen.getAllByText('break it').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: /^All/ }))
  expect(host.adjustPage).toHaveBeenLastCalledWith(undefined, '')
  expect(screen.getAllByText('Login page').length).toBeGreaterThan(0)
  // Opened at the query of a pick (a reload, Back from a run), the page shows the list the person left.
  unmount()
  window.history.replaceState(null, '', '/logs?status=failed')
  render(page)
  await screen.findAllByText('break it')
  expect(screen.queryAllByText('Login page')).toHaveLength(0)
  cleanup()
  // A status no run has any more shows them all.
  window.history.replaceState(null, '', '/logs?status=stopped')
  render(page)
  expect((await screen.findAllByText('Login page')).length).toBeGreaterThan(0)
  // A row opens its run.
  fireEvent.click(screen.getAllByText('Login page')[0]!.closest('a')!)
  expect(host.openAgent).toHaveBeenCalledWith('p1', 'r1')
})

test("a run's name is a link to the run: the keyboard reaches it, it opens the run once, on a phone too, and a Ctrl+click is the browser's", async () => {
  const host = hostWith([{ id: 'r1', startedAt: at(now - 1000), endedAt: at(now), status: 'done', title: 'Login page' }])
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const link = await screen.findByRole('link', { name: 'Login page' })
  expect(link.getAttribute('href')).toBe('/p1/r1')
  expect(fireEvent.click(link, { ctrlKey: true })).toBe(true)
  expect(host.openAgent).not.toHaveBeenCalled()
  fireEvent.click(link)
  expect(host.openAgent.mock.calls).toEqual([['p1', 'r1']])
})

test("each status is the sidebar's mark and word: a waiting run's hexagon is in the waiting colour and it needs an answer, and one that ended is a quiet outline", async () => {
  const host = hostWith([
    { id: 'r1', startedAt: at(now - 1000), status: 'waiting', title: 'Asks' },
    { id: 'r2', startedAt: at(now - 2000), endedAt: at(now - 1000), status: 'done', title: 'Ended' },
  ])
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const mark = (title: string) => screen.getAllByText(title)[0]!.closest('li')!.querySelector('svg')!.getAttribute('class')
  await screen.findAllByText('Asks')
  expect(mark('Asks')).toContain('text-warning')
  expect(mark('Ended')).toContain('text-faint-foreground')
  // The Human Queue's two words for a run parked on a question: one word for one state.
  expect(screen.getAllByText('Asks')[0]!.closest('li')!.textContent).toContain('Needs answer')
})

test("a run whose pull request merged reads as the sidebar's merged run, its number a link to the request", async () => {
  const pr = { number: 48, url: 'https://example.com/pull/48' }
  const host = hostWith(
    [
      { id: 'r1', startedAt: at(now - 2000), endedAt: at(now - 1000), status: 'done', title: 'Landed', pr },
      { id: 'r2', startedAt: at(now - 4000), endedAt: at(now - 3000), status: 'done', title: 'Open request', pr: { number: 49, url: 'https://example.com/pull/49' } },
    ],
    // The dashboard's word on the runs, as the sidebar has it: the git host says how each request stands.
    [
      { id: 'r1', startedAt: at(now - 2000), endedAt: at(now - 1000), status: 'done', title: 'Landed', pr: { ...pr, state: 'merged' } },
      { id: 'r2', startedAt: at(now - 4000), endedAt: at(now - 3000), status: 'done', title: 'Open request', pr: { number: 49, url: 'https://example.com/pull/49', state: 'open' } },
    ],
  )
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const row = (title: string) => screen.getAllByText(title)[0]!.closest('li')!
  await waitFor(() => expect(within(row('Landed')).getByText('Merged')).toBeTruthy())
  // The merged run's mark is the merge glyph, as the sidebar draws it (RunMark).
  expect(row('Landed').querySelector('svg.lucide-git-merge')).toBeTruthy()
  expect(within(row('Landed')).getByRole('link', { name: '#48' }).getAttribute('href')).toBe(pr.url)
  // A request still open: the run is done.
  expect(within(row('Open request')).getByText(/^Done/)).toBeTruthy()
})

test("a run stands as its sidebar row does: one that waits on the person waits, in the words of its item there, under a chip of its own first; one whose pull request merged after it was stopped is merged", async () => {
  const open = { number: 50, url: 'https://example.com/pull/50' }
  const landed = { number: 51, url: 'https://example.com/pull/51' }
  const cards = [
    { id: 'r1', startedAt: at(now - 41 * 60_000), endedAt: at(now - 1000), status: 'done', title: 'Open request', pr: open },
    { id: 'r2', startedAt: at(now - 50 * 60_000), endedAt: at(now - 45 * 60_000), status: 'stopped', title: 'Image paste', pr: landed },
    { id: 'r3', startedAt: at(now - 60 * 60_000), endedAt: at(now - 55 * 60_000), status: 'done', title: 'Plain done' },
  ]
  const host = hostWith(cards, [
    { ...cards[0], pr: { ...open, state: 'open' } },
    { ...cards[1], pr: { ...landed, state: 'merged' } },
  ])
  shell.items = [{ kind: 'waiting', module: 'github', scope: 'run', run: 'r1', id: open.url, words: 'Needs merge', title: 'Open request', detail: '#50', mark: 'pull-request', projectId: 'p1', projectName: 'alpha' }]
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const row = (title: string) => screen.getAllByText(title)[0]!.closest('li')!
  await waitFor(() => expect(within(row('Image paste')).getByText('Merged')).toBeTruthy())
  // Waiting, as the sidebar lists it under "Waiting on you": its hexagon waits, and its line says what it needs, not that it is done.
  expect(within(row('Open request')).getByText('Needs merge')).toBeTruthy()
  expect(row('Open request').textContent).not.toMatch(/Done/)
  expect(row('Open request').querySelector('svg')!.getAttribute('class')).toContain('text-warning')
  // Stopped, its pull request merged later: the merge glyph, as the sidebar marks it.
  expect(row('Image paste').querySelector('svg.lucide-git-merge')).toBeTruthy()
  expect(row('Image paste').textContent).not.toMatch(/Stopped/)
  // The chips: All, then what waits on the person, each with its count; a run under one chip only.
  const chips = screen.getAllByRole('button').filter(button => /^(All|Waiting|Done|Merged|Stopped)/.test(button.textContent ?? ''))
  expect(chips.map(chip => chip.textContent)).toEqual(['All3', 'Waiting1', 'Done1', 'Merged1'])
  fireEvent.click(chips[1]!)
  expect(host.adjustPage).toHaveBeenLastCalledWith(undefined, 'status=waiting')
  expect(screen.getAllByText('Open request').length).toBeGreaterThan(0)
  expect(screen.queryAllByText('Plain done')).toHaveLength(0)
  expect(screen.queryAllByText('Image paste')).toHaveLength(0)
})

test("a row's press opens the run: Answer where its question waits, Review for any other", async () => {
  const host = hostWith([
    { id: 'r1', startedAt: at(now - 1000), status: 'waiting', title: 'Asks' },
    { id: 'r2', startedAt: at(now - 2000), endedAt: at(now - 1000), status: 'done', title: 'Ended' },
  ])
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Answer: Asks' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review: Ended' }))
  expect(host.openAgent.mock.calls).toEqual([['p1', 'r1'], ['p1', 'r2']])
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
  const row = (title: string) => screen.getAllByText(title)[0]!.closest('li')!.textContent
  await screen.findAllByText('Asks')
  expect(row('Asks')).not.toMatch(/\dm/)
  expect(row('Halted')).toContain('2m')
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

test("a run's branch keeps its ending where its column is too narrow: runs started the same minute differ only there", async () => {
  const branches = ['agent-2026-11-15T18-12-13-950Z', 'agent-2026-11-15T18-12-19-219Z']
  render(
    <ModuleHostContext.Provider value={hostWith(branches.map((branch, i) => ({ id: `r${i}`, startedAt: at(now - i * 1000), status: 'done', title: `Run ${i}`, branch })))}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  for (const branch of branches) {
    const column = await screen.findByTitle(branch)
    // Said whole to a screen reader; drawn as a start that gives way and an ending that stays.
    expect(within(column).getByText(branch).className).toContain('sr-only')
    expect(within(column).getByText(branch.slice(-10)).className).toContain('shrink-0')
  }
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
  render(page(fakeHost('@openagt/logs', { call: () => new Promise(() => {}), agents: () => new Promise(() => {}) })))
  expect(screen.getAllByText('Login page').length).toBeGreaterThan(0)
  expect(screen.queryByText('Loading…')).toBeNull()
  const row = screen.getAllByText('Login page')[0]!
  expect(row.closest('[data-stale]')).toBeNull()
  await waitFor(() => expect(row.closest('[data-stale]')).not.toBeNull(), { timeout: 2000 })
})

test('the runs the dashboard lists show while the records are still read, with no "Loading…" over them', async () => {
  const host = fakeHost('@openagt/logs', {
    call: () => new Promise(() => {}),
    agents: async (projectId: string) => (projectId === 'session' ? [] : [{ id: 'r1', startedAt: at(now - 1000), status: 'running', title: 'Going' }]) as ModuleAgent[],
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

test('each run as the dashboard says it stands: a record that still says running reads as the run ended, and a run with no record yet is listed', async () => {
  const host = hostWith(
    // The records are behind the runs.
    [{ id: 'r1', startedAt: at(now - 5000), status: 'running', intent: 'behind in the records' }],
    [
      { id: 'r1', startedAt: at(now - 5000), endedAt: at(now - 4000), status: 'stopped', ask: 'behind in the records' },
      { id: 'r2', startedAt: at(now - 1000), endedAt: at(now), status: 'done', title: 'Not recorded yet', cost: 0.3 },
    ],
  )
  render(
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
  const added = (await screen.findAllByText('Not recorded yet'))[0]!.closest('li')!
  expect(added.textContent).toContain('Done')
  const behind = screen.getAllByText('behind in the records')[0]!.closest('li')!
  expect(behind.textContent).toContain('Stopped')
  expect(screen.queryAllByText(/^Working/)).toHaveLength(0)
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
  const row = (title: string) => screen.getAllByText(title)[0]!.closest('li')!
  await waitFor(() => expect(within(row('Hers')).getByRole('img', { name: 'ada@x.dev · ada' }).querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1'))
  expect(within(row('Going')).getByRole('img', { name: 'ada@x.dev · ada' })).toBeTruthy()
  expect(within(row('His')).getByRole('img', { name: 'git@brillout.com' }).textContent).toBe('BR')
  expect(within(row('Very old')).queryByRole('img')).toBeNull()
  expect(row('Very old').querySelector('span.size-5')).toBeTruthy()
  // Each person once, however many runs are theirs; and not again when the page reads its runs again.
  expect(vi.mocked(host.gitHostPeople).mock.calls.at(-1)).toEqual(['p1', ['ada@x.dev', 'git@brillout.com']])
})

test('a project that gave the whole page of 50 runs has older ones: the page says it lists the last 50; one with fewer lists every run; the one project shown is named', async () => {
  const cards = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `r${index}`, startedAt: at(now - index * 1000), endedAt: at(now - index * 1000 + 500), status: 'done', intent: `run ${index}` }))
  const page = (host: FakeHost) => (
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>
  )
  render(page(hostWith(cards(50))))
  expect(await screen.findByText('The last 50 runs recorded in alpha, newest first.')).toBeTruthy()
  cleanup()
  forgetRemembered()
  render(page(hostWith(cards(49))))
  expect(await screen.findByText('Every run recorded in alpha, newest first.')).toBeTruthy()
  await screen.findAllByText('run 48')
  expect(screen.queryByText(/^The last 50 runs/)).toBeNull()
})

test("a run whose work never left this machine says what it needs in the sidebar's words: a commit, else a push, or a pull request where the project can open one", async () => {
  const host = hostWith(
    [],
    [
      { id: 'r1', startedAt: at(now - 3000), endedAt: at(now), status: 'done', title: 'Committed a login page', name: 'agent-1', unpublished: 1 },
      { id: 'r2', startedAt: at(now - 2000), endedAt: at(now), status: 'done', title: 'Left files', name: 'agent-2', uncommitted: 2, unpublished: 3 },
      { id: 'r3', startedAt: at(now - 1000), endedAt: at(now), status: 'done', title: 'Pushed', name: 'agent-3' },
    ],
  )
  const page = (gitHost: boolean) => (
    <ModuleHostContext.Provider value={host}>
      <LogsPage projects={[{ id: 'p1', name: 'alpha', gitHost }]} projectId={null} path={[]} />
    </ModuleHostContext.Provider>
  )
  render(page(false))
  const row = async (name: string) => (await screen.findAllByText(name))[0]!.closest('li')!
  // Two facts of the line, joined by its one dot as its others are.
  expect((await row('Committed a login page')).textContent).toContain('Needs push·1 commit')
  expect((await row('Left files')).textContent).toContain('Needs commit·2 files')
  expect((await row('Pushed')).textContent).not.toMatch(/Needs/)
  cleanup()
  forgetRemembered()
  render(page(true))
  expect((await row('Committed a login page')).textContent).toContain('Needs PR·1 commit')
})

test("each project's newest 50 runs are read through the server part; a project whose read fails is named with why, and the others still show", async () => {
  const call = vi.fn(async (projectId: string) =>
    projectId === 'p2' ? { ok: false as const, error: 'origin could not be fetched' } : { ok: true as const, output: [{ id: 'r1', startedAt: at(now - 1000), endedAt: at(now), status: 'done', title: 'Login page' }] },
  )
  render(
    <ModuleHostContext.Provider value={fakeHost('@openagt/logs', { call, agents: async () => [] })}>
      <LogsPage
        projects={[
          { id: 'p1', name: 'alpha', gitHost: true },
          { id: 'p2', name: 'beta', gitHost: true },
        ]}
        projectId={null}
        path={[]}
      />
    </ModuleHostContext.Provider>,
  )
  expect((await screen.findByRole('alert')).textContent).toBe('Could not read the runs of beta: origin could not be fetched')
  expect(screen.getAllByText('Login page').length).toBeGreaterThan(0)
  expect(call.mock.calls).toEqual([
    ['p1', 'runs', { limit: 50 }],
    ['p2', 'runs', { limit: 50 }],
  ])
})

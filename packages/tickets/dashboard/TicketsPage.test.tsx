import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { configureFirst } from '../../ui/dashboard/test-utils.js'
import { forgetRemembered } from '@openagt/ui/module'
import { mountedOf, type MountedModules } from '@openagt/ui/module/testing'
import { workOnTicketPrompt } from '../src/module.js'
import { fakeHost, renderWithHost, type Answers, type FakeHost } from './test-host.js'
import { TicketsPage } from './TicketsPage.js'
import { TicketDetailPage } from './TicketDetailPage.js'

// The page reads every project's tickets with the server part's `list` through the host, and its
// sections read the last-import stamp with its `meta`. `groups` is what those answer, per
// project; the page is rendered for exactly those projects.
type Group = { projectId: string; projectName: string; tickets: Record<string, unknown>[] }
let groups: Group[] = []
let host: FakeHost
const onAllTickets = { mockResolvedValue: (value: Group[]) => (groups = value) }

// The one link action an installed module offers here (#1774): a queue package's "Add to queue",
// present in every project of these stories. Its `run` is the spy the selection's adds are read by:
// one call per project, the links in the shown order.
const addToQueue = vi.fn()
const modules = (projects: string[] = ['p1', 'p2']): MountedModules =>
  mountedOf({ actions: { 'link.menu': [{ place: 'link.menu', id: 'add-to-queue', label: 'Add to queue', doneLabel: 'Queued', run: addToQueue, package: '@x/queue', projects }] } })
const render = (mounted: MountedModules = modules()) => {
  const answers: Answers = {}
  for (const g of groups) answers[g.projectId] = { list: g.tickets, meta: {} }
  host = fakeHost(answers)
  return renderWithHost(<TicketsPage projects={groups.map(g => ({ id: g.projectId, name: g.projectName, remote: 'github.com/me/project' }))} />, host, mounted)
}
/** The starts the host was asked for: `[projectId, prompt]` each. */
const started = () => host.startRun.mock.calls.map(([projectId, prompt]) => [projectId, prompt])

const ticket = (over: Record<string, unknown> = {}) => ({
  file: 't.md',
  title: 'Do the thing',
  summary: '',
  date: '2026-01-01T00:00:00.000Z',
  planned: false,
  ...over,
})

beforeEach(() => {
  groups = []
  // The page reads its view from the URL on mount and mirrors changes back via replaceState, so
  // every test starts from a clean address.
  window.history.replaceState(null, '', '/tickets')
})

/** A fresh module action for the tests that press the selection's adds. */
const controls = async () => {
  addToQueue.mockReset().mockResolvedValue({ ok: true })
  return { addToQueue }
}

/** The links one `addToQueue` call was handed, for the project it was called on. */
const handed = (projectId: string) => addToQueue.mock.calls.filter(call => call[1].projectId === projectId).map(call => call[1].links)
const link = (title: string, file: string, priority = 5) => ({ text: title, href: `tickets/${file}`, priority })
const plan = (file: string, priority = 5) => ({ text: `Create tickets/${file.replace(/\.md$/, '')}.plan.md`, priority })
/** Ticks the rows of these titles, as a person does. */
const tick = (...titles: string[]) => titles.forEach(title => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${title}` })))

afterEach(cleanup)

// The Tickets view (#1144): every registered project's backlog, or the picked one's.
describe('TicketsPage (#1144)', () => {
  test("its header is the other pages' header: the same title and line under it; the line says whose backlog shows", async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ title: 'Do the thing' })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Do the other thing' })] },
    ])
    render()
    await screen.findByText('Do the thing')
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe('Tickets')
    expect(title.className).toBe('text-2xl font-semibold tracking-tight')
    const line = title.closest('header')!.querySelector('p')!
    expect(line.textContent).toBe('Every project’s backlog agents plan from, read from tickets/.')
    expect(line.className).toBe('mt-2 text-sm text-muted-foreground max-md:sr-only')
    expect(title.closest('.border-b')).toBeNull()
    cleanup()
    // With one project shown, the line does not say "every"; when its tickets last came from the
    // tracker, the update, then New ticket, the primary, stand last in the header's row.
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ title: 'Do the thing' })] }])
    render()
    await screen.findByText('Do the thing')
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!
    expect(header.querySelector('p')!.textContent).toBe('The backlog agents plan from, read from tickets/.')
    expect(within(header).getByText('Never updated')).toBeTruthy()
    const presses = within(header.firstElementChild as HTMLElement).getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent?.trim())
    expect(presses.slice(-3)).toEqual(['Update tickets', 'Other ways to update the tickets', 'New ticket'])
  })

  test("Update tickets' menu sets the run up before it starts: Configure first opens the launcher with the update", async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ title: 'Do the thing' })] }])
    render()
    await screen.findByText('Do the thing')
    await configureFirst('Other ways to update the tickets')
    await waitFor(() => expect(host.configureRun).toHaveBeenCalledWith('p1', '/update-tickets'))
    expect(host.startRun).not.toHaveBeenCalled()
  })

  test("reads every project's tickets and lists each under its own project heading", async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ title: 'Do the thing' })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Do the other thing' })] },
    ])
    render()
    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
    expect(screen.getByText('Do the thing')).toBeTruthy()
    expect(screen.getByText('Do the other thing')).toBeTruthy()
  })
  test('opening a row hands back its project and file, for the detail route (#1144)', async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [ticket()] }])
    render()
    fireEvent.click(await screen.findByText('Do the thing'))
    // The module's own page for that ticket: where the dashboard's link convention sends a link to it.
    expect(host.openPage).toHaveBeenCalledWith('tickets', ['t.md'], 'p1')
    expect(screen.getByRole('link', { name: 'Do the thing' }).getAttribute('href')).toBe('/p1/tickets/t.md')
  })

  test("a ticket's page opened from the list goes back to it by the dashboard's return, which is the browser's Back when the list is the entry behind", async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [ticket()] }])
    render()
    fireEvent.click(await screen.findByText('Do the thing'))
    expect(host.openPage).toHaveBeenCalledWith('tickets', ['t.md'], 'p1')
    cleanup()
    const page = fakeHost({ p1: { 'show t.md': { ticket: { ...ticket(), content: '# Do the thing' } } } })
    renderWithHost(<TicketDetailPage projectId="p1" slug="t.md" />, page, modules())
    fireEvent.click(await screen.findByRole('button', { name: /tickets/i }))
    expect(page.backToPage).toHaveBeenCalledWith('tickets')
  })

  test('a second visit opens with the last list at once, faded once its fresh read has been out a second', async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [ticket()] }])
    render()
    await screen.findByText('Do the thing')
    cleanup()
    forgetRemembered()
    const slow = fakeHost()
    // Answered only once the test has looked, so no read is left out for the next test.
    const reads: (() => void)[] = []
    slow.call.mockImplementation(() => new Promise(resolve => reads.push(() => resolve({ ok: false, error: 'read too late' }))))
    try {
      renderWithHost(<TicketsPage projects={[{ id: 'p1', name: 'Alpha', remote: 'github.com/me/project' }]} />, slow, modules())
      const row = screen.getByText('Do the thing')
      expect(row.closest('[data-stale]')).toBeNull()
      await waitFor(() => expect(row.closest('[data-stale]')).not.toBeNull(), { timeout: 2000 })
    } finally {
      for (const answer of reads) answer()
      await waitFor(() => expect(document.querySelector('[data-stale]')).toBeNull())
      cleanup()
      forgetRemembered()
    }
  })

  test('a project with no tickets still offers its own update, not a dead end', async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [] }])
    render()
    expect(await screen.findByRole('button', { name: 'Update tickets' })).toBeTruthy()
  })

  test('with no ticket in any project there is nothing to filter: the page says so in one line, with no filters and no search', async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [] }])
    render()
    expect(await screen.findByText('No tickets yet. Update them from the tracker, or write one.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /search tickets/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Priority/ })).toBeNull()
    // The head's two presses stay.
    expect(screen.getByRole('button', { name: 'Update tickets' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /New ticket/ })).toBeTruthy()
  })

  test('no project with the package says so rather than an empty page', async () => {
    onAllTickets.mockResolvedValue([])
    render()
    expect(await screen.findByText(/no project has the tickets package/i)).toBeTruthy()
  })

  test('an import/update started in one project\'s section starts in that project (#948)', async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [] }])
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
    await waitFor(() => expect(started()).toEqual([['p1', '/update-tickets']]))
  })

  test('a project whose command fails is named with the reason, and the others still show', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ title: 'Do the thing' })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [] },
    ])
    groups[1]!.tickets = undefined as unknown as Record<string, unknown>[]
    render()
    expect(await screen.findByText('Do the thing')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Beta' })).getByRole('alert').textContent).toMatch(/Could not read the tickets: no answer for p2/)
  })

  test("a claim naming one of the project's runs reads as its session name and opens the run (#1748)", async () => {
    const run = { id: '2026-08-30T10-00-00-000Z', name: 'login-page', status: 'running' as const, startedAt: '2026-08-30T10:00:00.000Z' }
    host = fakeHost({ p1: { list: [ticket({ locked: true, lockedBy: run.id })], meta: {} } }, { p1: [run] })
    renderWithHost(<TicketsPage projects={[{ id: 'p1', name: 'Alpha', remote: 'github.com/me/project' }]} />, host, modules())
    // Named as its run, and how that run stands.
    fireEvent.click(await screen.findByRole('button', { name: 'Claimed by login-page: working' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', run.id)
  })
})

// The order (#1144/#1265): by priority, highest first, ties newest first; any other key from the sort's menu.
describe('TicketsPage sort (#1144/#1265)', () => {
  const twoByPriority = () =>
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          ticket({ file: 'low.md', title: 'Low priority', priority: '2', date: '2026-02-01T00:00:00.000Z' }),
          ticket({ file: 'high.md', title: 'High priority', priority: '9' }),
        ],
      },
    ])
  const titles = async () => (await screen.findAllByRole('link')).map(b => b.textContent)

  test('opens by priority, the highest first, and says so', async () => {
    twoByPriority()
    render()
    await screen.findByText('Low priority')
    const order = await titles()
    expect(order.findIndex(t => t?.includes('High priority'))).toBeLessThan(order.findIndex(t => t?.includes('Low priority')))
    expect(screen.getByRole('button', { name: 'Sorted by priority, highest first' })).toBeTruthy()
  })

  test('sorting by date puts the newest first, and lands in the URL', async () => {
    twoByPriority()
    render()
    await screen.findByText('Low priority')
    fireEvent.click(screen.getByRole('button', { name: /^sorted by priority/i }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Date' }))
    const order = await titles()
    expect(order.findIndex(t => t?.includes('Low priority'))).toBeLessThan(order.findIndex(t => t?.includes('High priority')))
    expect(host.adjustPage).toHaveBeenLastCalledWith(undefined, 'sort=date')
  })

  test('a priority tie falls back to newest first, not an arbitrary order', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          ticket({ file: 'older.md', title: 'Older', priority: '5', date: '2026-01-01T00:00:00.000Z' }),
          ticket({ file: 'newer.md', title: 'Newer', priority: '5', date: '2026-02-01T00:00:00.000Z' }),
        ],
      },
    ])
    render()
    await screen.findByText('Newer')
    const order = await titles()
    expect(order.findIndex(t => t?.includes('Newer'))).toBeLessThan(order.findIndex(t => t?.includes('Older')))
  })
})

// The filters (#1144): search + facets, state mirrored to the URL so a filtered view is a link.
describe('TicketsPage filters (#1144)', () => {
  const fixture = (
    tickets = [
      ticket({ file: 'lock.md', title: 'Improve the lock', topics: ['dx'], priority: '9' }),
      ticket({ file: 'other.md', title: 'Something else', locked: true, lockedBy: 'agent-1' }),
    ],
  ) => onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets }])

  test("clicking a row's topic badge adds that topic filter (#1144)", async () => {
    fixture()
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'dx' }))
    await waitFor(() => expect(screen.queryByText('Something else')).toBeNull())
    expect(host.adjustPage).toHaveBeenLastCalledWith(undefined, 'topics=dx')
  })

  test('a badge whose topic is capitalised filters by it just the same', async () => {
    fixture([ticket({ file: 'ux.md', title: 'Polish the rail', topics: ['UX'] }), ticket({ file: 'other.md', title: 'Something else' })])
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'UX' }))
    await waitFor(() => expect(screen.queryByText('Something else')).toBeNull())
    expect(screen.getByText('Polish the rail')).toBeTruthy()
    expect(host.adjustPage).toHaveBeenLastCalledWith(undefined, 'topics=ux')
  })

  test('clicking the claim marker narrows to claimed tickets', async () => {
    fixture()
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Claimed by agent-1' }))
    await waitFor(() => expect(screen.queryByText('Improve the lock')).toBeNull())
    expect(screen.getByText('Something else')).toBeTruthy()
    expect(host.adjustPage).toHaveBeenLastCalledWith(undefined, 'stage=claimed')
  })

  test('searching narrows the rows and writes q= to the URL', async () => {
    fixture()
    render()
    await screen.findByText('Improve the lock')
    fireEvent.change(screen.getByRole('textbox', { name: /search tickets/i }), { target: { value: 'lock' } })
    await waitFor(() => expect(screen.queryByText('Something else')).toBeNull())
    expect(screen.getByText('Improve the lock')).toBeTruthy()
    expect(host.adjustPage).toHaveBeenLastCalledWith(undefined, 'q=lock')
  })

  test('the URL is the initial state: mounting under ?q= starts filtered', async () => {
    fixture()
    window.history.replaceState(null, '', '/tickets?q=lock')
    render()
    expect(await screen.findByText('Improve the lock')).toBeTruthy()
    expect(screen.queryByText('Something else')).toBeNull()
  })

  test('a project filtered to nothing says so and clears from right there', async () => {
    fixture()
    window.history.replaceState(null, '', '/tickets?q=zzz-no-match')
    render()
    expect(await screen.findByText('2 tickets hidden by the filters.')).toBeTruthy()
    // A filter that leaves no row keeps the filters: they are how to get the rows back.
    expect(screen.getByRole('textbox', { name: /search tickets/i })).toBeTruthy()
    // Not an update offer in the list: these tickets exist, they are filtered (#1230); the page's head keeps its own.
    expect(screen.getAllByRole('button', { name: 'Update tickets' }).every(button => button.closest('header'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(await screen.findByText('Improve the lock')).toBeTruthy()
    expect(host.adjustPage).toHaveBeenLastCalledWith(undefined, '')
  })
})

// Group by (#1144): project sections by default; a flat cross-project list on demand — the one
// view that can answer "what is the single highest-priority ticket anywhere".
describe('TicketsPage grouping (#1144)', () => {
  test('group=none renders one flat list, rows tagged with their project, sorted across projects', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'Alpha ticket', priority: '2' })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Beta ticket', priority: '9' })] },
    ])
    window.history.replaceState(null, '', '/tickets?sort=priority&group=none')
    render()
    await screen.findByText('Beta ticket')
    // Project names ride the rows now — there are no section headings to say them.
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    // Cross-project priority order: Beta's 9 above Alpha's 2.
    const titles = (await screen.findAllByRole('link')).map(b => b.textContent)
    expect(titles.findIndex(t => t?.includes('Beta ticket'))).toBeLessThan(titles.findIndex(t => t?.includes('Alpha ticket')))
    // No per-project Update bars in the flat list.
    expect(screen.queryByRole('button', { name: 'Update tickets' })).toBeNull()
  })

  test('opening a flat row still hands back its own project and file', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Beta ticket' })] },
    ])
    window.history.replaceState(null, '', '/tickets?group=none')
    render()
    fireEvent.click(await screen.findByText('Beta ticket'))
    expect(host.openPage).toHaveBeenCalledWith('tickets', ['b.md'], 'p2')
  })

  test("a flat row's start button spins up an agent in that row's own project (#1144)", async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Beta ticket', planned: true })] },
    ])
    window.history.replaceState(null, '', '/tickets?group=none')
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    // The row's own project, not a panel-bound one — the flat list carries one per row.
    await waitFor(() => expect(started()).toEqual([['p2', workOnTicketPrompt('b.md')]]))
  })

  test("a flat row's Configure first opens that row's own project's launcher (#1507)", async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'Alpha ticket', planned: true })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Beta ticket', planned: true })] },
    ])
    window.history.replaceState(null, '', '/tickets?group=none')
    render()
    await configureFirst('Other ways to work on Beta ticket')
    // The row's own project, not the first one the page happens to list.
    await waitFor(() => expect(host.configureRun).toHaveBeenCalledWith('p2', workOnTicketPrompt('b.md')))
    expect(host.startRun).not.toHaveBeenCalled()
  })
})

// The selection's adds: every ticked ticket an agent may be handed goes to the queue's action, as
// the ticket or as the ask for its plan (what is already queued is the action's own to skip), and
// no agent starts: the queue's own consumers do that.
describe("TicketsPage queues the selection", () => {
  const twoTickets = () =>
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [ticket({ file: 'a.md', title: 'First', priority: '7' }), ticket({ file: 'b.md', title: 'Second' })],
      },
    ])

  test('nothing ticked, no adds: the bar comes with the first tick', async () => {
    twoTickets()
    render()
    await screen.findByText('First')
    expect(screen.queryByRole('button', { name: /^Add to queue:/ })).toBeNull()
    tick('First')
    expect(screen.getByRole('region', { name: 'Selected tickets' })).toBeTruthy()
  })

  test('every ticked ticket joins the queue, and the press rests as Queued until the set changes', async () => {
    twoTickets()
    await controls()
    render()
    await screen.findByText('First')
    tick('First', 'Second')
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: 2 tickets' }))
    // Queued as the ticket's page queues (#1164): title as the entry, the ticket named so the entry links back, its priority picking the section.
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1))
    expect(handed('p1')).toEqual([[link('First', 'a.md', 7), link('Second', 'b.md')]])
    expect(host.startRun).not.toHaveBeenCalled()
    const queued = await screen.findByRole('button', { name: 'Queued: 2 tickets' })
    expect(queued.getAttribute('aria-disabled')).toBe('true')
    // Changing the selection is a new set: the press arms again, counting it.
    tick('Second')
    expect(await screen.findByRole('button', { name: 'Add to queue: 1 ticket' })).toBeTruthy()
  })

  test('claimed tickets are left to the agents holding them, and the press counts without them', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [ticket({ file: 'a.md', title: 'First' }), ticket({ file: 'b.md', title: 'Second', locked: true, lockedBy: 'agent-1' })],
      },
    ])
    await controls()
    render()
    await screen.findByText('First')
    tick('First', 'Second')
    expect(screen.getByText('2 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: 1 ticket' }))
    await screen.findByRole('button', { name: /^Queued:/ })
    expect(handed('p1')).toEqual([[link('First', 'a.md')]])
  })

  test('tickets in review or waiting are left out of both adds, and the presses count without them', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          ticket({ file: 'a.md', title: 'First' }),
          ticket({ file: 'b.md', title: 'Second', pr: { label: '#12', url: 'https://example.com/pull/12' } }),
          ticket({ file: 'c.md', title: 'Third', waiting: 'the vendor' }),
        ],
      },
    ])
    await controls()
    render()
    await screen.findByText('First')
    tick('First', 'Second', 'Third')
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: 1 plan' }))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1))
    expect(handed('p1')).toEqual([[plan('a.md')]])
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: 1 ticket' }))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(2))
    expect(handed('p1')).toEqual([[plan('a.md')], [link('First', 'a.md')]])
  })

  test('a selection all in review, waiting or claimed is not an offer', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          ticket({ file: 'b.md', title: 'Second', pr: { label: '#12', url: 'https://example.com/pull/12' } }),
          ticket({ file: 'c.md', title: 'Third', waiting: 'the vendor' }),
          ticket({ file: 'd.md', title: 'Fourth', locked: true }),
        ],
      },
    ])
    await controls()
    render()
    await screen.findByText('Second')
    tick('Second', 'Third', 'Fourth')
    expect(screen.getByText('3 selected')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Add to queue:/ })).toBeNull()
  })

  test('every ticked ticket still to plan gets its plan queued, and the press rests as Queued', async () => {
    twoTickets()
    await controls()
    render()
    await screen.findByText('First')
    tick('First', 'Second')
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: 2 plans' }))
    // One plan ask per ticket, at its priority; neither an implementation entry nor an agent comes of it.
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1))
    expect(handed('p1')).toEqual([[plan('a.md', 7), plan('b.md')]])
    expect(host.startRun).not.toHaveBeenCalled()
    expect((await screen.findByRole('button', { name: 'Queued: 2 plans' })).getAttribute('aria-disabled')).toBe('true')
  })

  test('planned and claimed tickets get no plan asked for, and the press counts only what is left to plan', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          ticket({ file: 'a.md', title: 'First' }),
          ticket({ file: 'b.md', title: 'Second', planned: true }),
          ticket({ file: 'c.md', title: 'Third', locked: true, lockedBy: 'agent-1' }),
        ],
      },
    ])
    await controls()
    render()
    await screen.findByText('First')
    tick('First', 'Second', 'Third')
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: 1 plan' }))
    await screen.findByRole('button', { name: /^Queued:/ })
    expect(handed('p1')).toEqual([[plan('a.md')]])
    // The planned one is still queued as work.
    expect(screen.getByRole('button', { name: 'Add to queue: 2 tickets' })).toBeTruthy()
  })

  test('every ticked ticket on the queue already: the ticket add rests as Queued, and their plans are not offered beside it', async () => {
    twoTickets()
    const mounted = modules()
    mounted.actions['link.menu'] = [{ ...mounted.actions['link.menu'][0]!, done: async () => () => true }]
    render(mounted)
    await screen.findByText('First')
    tick('First', 'Second')
    await screen.findByRole('button', { name: 'Queued: 2 tickets' })
    expect(screen.queryByRole('button', { name: 'Add to queue: 2 plans' })).toBeNull()
  })

  test('the ticket add pressed: it rests as Queued, and the plan add beside it goes at once', async () => {
    twoTickets()
    await controls()
    render()
    await screen.findByText('First')
    tick('First')
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: 1 ticket' }))
    await screen.findByRole('button', { name: 'Queued: 1 ticket' })
    expect(screen.queryByRole('button', { name: 'Add to queue: 1 plan' })).toBeNull()
  })

  test('one ticked ticket not on the queue yet: both adds are offered', async () => {
    twoTickets()
    const mounted = modules()
    mounted.actions['link.menu'] = [{ ...mounted.actions['link.menu'][0]!, done: async () => link => link.href === 'tickets/a.md' }]
    render(mounted)
    await screen.findByText('First')
    tick('First', 'Second')
    expect(await screen.findByRole('button', { name: 'Add to queue: 2 plans' })).toBeTruthy()
    // The ticket add counts only the one not on the queue yet.
    expect(screen.getByRole('button', { name: 'Add to queue: 1 ticket' })).toBeTruthy()
  })

  test('a plan already on the queue is not counted, and done, the button names the whole set', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [ticket({ file: 'a.md', title: 'First' }), ticket({ file: 'b.md', title: 'Second' }), ticket({ file: 'c.md', title: 'Third' })],
      },
    ])
    await controls()
    // The queue reads b's plan as on it already.
    const queued = modules()
    queued.actions['link.menu'][0]!.done = async () => link => link.text === plan('b.md').text
    render(queued)
    await screen.findByText('First')
    tick('First', 'Second', 'Third')
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue: 2 plans' }))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1))
    expect((await screen.findByRole('button', { name: 'Queued: 3 plans' })).getAttribute('aria-disabled')).toBe('true')
  })

  test.each(['ticket', 'plan'])('across projects, the %s add done counts what it added, on the projects with a queue alone', async kind => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'First' })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Second' })] },
    ])
    await controls()
    render(modules(['p1']))
    await screen.findByText('First')
    tick('First', 'Second')
    fireEvent.click(await screen.findByRole('button', { name: `Add to queue: 1 ${kind}` }))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1))
    expect([handed('p1'), handed('p2')]).toEqual([[[kind === 'plan' ? plan('a.md') : link('First', 'a.md')]], []])
    expect(await screen.findByRole('button', { name: `Queued: 1 ${kind}` })).toBeTruthy()
  })

  test('no module offering an action on links, no adds at all (#1774)', async () => {
    twoTickets()
    render(modules([]))
    await screen.findByText('First')
    tick('First')
    expect(screen.queryByRole('button', { name: /^Add to queue:/ })).toBeNull()
  })

  test('after one tick, Select all ticks every shown ticket, and is gone once they all are', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'First' }), ticket({ file: 'b.md', title: 'Second' }), ticket({ file: 'c.md', title: 'Third' })] },
    ])
    await controls()
    render()
    await screen.findByText('First')
    tick('Second')
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('3 selected')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to queue: 3 tickets' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Select all' })).toBeNull()
  })

  test('clearing the selection takes the bar and its adds away', async () => {
    twoTickets()
    render()
    await screen.findByText('First')
    tick('First')
    expect(screen.getByRole('button', { name: 'Add to queue: 1 ticket' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear the selection' }))
    // The bar leaves in 120ms.
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull())
    expect(screen.queryByRole('button', { name: /^Add to queue:/ })).toBeNull()
  })

  test('Escape clears the selection, as its clear does', async () => {
    twoTickets()
    render()
    await screen.findByText('First')
    tick('First')
    expect(screen.getByText('1 selected')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull())
    expect(screen.getByRole('checkbox', { name: 'Select First' }).getAttribute('data-checked')).toBeNull()
  })

  test('a ticked ticket the filters hide is neither counted nor acted on, and stays ticked', async () => {
    twoTickets()
    await controls()
    render()
    await screen.findByText('Second')
    tick('Second')
    fireEvent.change(screen.getByRole('textbox', { name: /search tickets/i }), { target: { value: 'First' } })
    await waitFor(() => expect(screen.queryByText('Second')).toBeNull())
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
    tick('First')
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: 1 ticket' }))
    await screen.findByRole('button', { name: /^Queued:/ })
    expect(handed('p1')).toEqual([[link('First', 'a.md', 7)]])
    // The tick itself survives the filter and comes back with the row.
    fireEvent.change(screen.getByRole('textbox', { name: /search tickets/i }), { target: { value: '' } })
    expect((await screen.findByRole('checkbox', { name: 'Select Second' })).getAttribute('data-checked')).not.toBeNull()
  })

  test('the flat cross-project list selects the same way, each row on its own project', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'Alpha ticket' })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Beta ticket' })] },
    ])
    window.history.replaceState(null, '', '/tickets?group=none')
    await controls()
    render()
    await screen.findByText('Beta ticket')
    tick('Beta ticket')
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: 1 ticket' }))
    await screen.findByRole('button', { name: /^Queued:/ })
    expect(addToQueue).toHaveBeenCalledTimes(1)
    expect(handed('p2')).toEqual([[link('Beta ticket', 'b.md')]])
  })
})

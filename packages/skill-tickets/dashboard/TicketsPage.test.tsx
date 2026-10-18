import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { configureFirst } from '../../openagent/dashboard/test-utils.js'
import type { MountedModules } from '../../openagent/dashboard/lib/use-modules.js'
import { workOnTicketPrompt } from '../src/module.js'
import { fakeHost, renderWithHost, type Answers, type FakeHost } from './test-host.js'
import { TicketsPage } from './TicketsPage.js'

// The page reads every project's tickets with `tickets list --local` through the host, and its
// sections read the last-import stamp with `tickets meta --local`. `onAllTickets` is what those
// commands answer, per project; the page is rendered for exactly those projects.
type Group = { projectId: string; projectName: string; tickets: Record<string, unknown>[] }
let groups: Group[] = []
let host: FakeHost
const onAllTickets = { mockResolvedValue: (value: Group[]) => (groups = value) }

// The one link action an installed module offers here (#1774): a queue package's "Add to queue",
// present in every project of these stories. Its `run` is the spy the heading's adds are read by:
// one call per project, the links in the shown order.
const addToQueue = vi.fn()
const modules = (projects: string[] = ['p1', 'p2']): MountedModules => ({
  pages: [],
  cards: [],
  linkActions: [{ label: 'Add to queue', doneLabel: 'Queued', run: addToQueue, package: '@x/queue', projects }],
  panels: [],
  runSlots: [],
  settings: [],
  loaded: true,
})
const render = (mounted: MountedModules = modules()) => {
  const answers: Answers = {}
  for (const g of groups) answers[g.projectId] = { 'list --local': g.tickets, 'meta --local': {} }
  host = fakeHost(answers)
  return renderWithHost(<TicketsPage projects={groups.map(g => ({ id: g.projectId, name: g.projectName, gitHost: true }))} />, host, mounted)
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

/** A fresh module action for the tests that click the header's adds. */
const controls = async () => {
  addToQueue.mockReset().mockResolvedValue({ ok: true })
  return { addToQueue }
}

/** The links one `addToQueue` call was handed, for the project it was called on. */
const handed = (projectId: string) => addToQueue.mock.calls.filter(call => call[1] === projectId).map(call => call[2])
const link = (title: string, file: string, priority = 5) => ({ text: title, href: `tickets/${file}`, priority })
const plan = (file: string, priority = 5) => ({ text: `Create tickets/${file.replace(/\.md$/, '')}.plan.md`, priority })

afterEach(cleanup)

// The Tickets view (#1144): every registered project's backlog, one section each — reading
// onAllTickets itself and handing each project's list to its own TicketsPanel, which already
// knows how to render a one-liner row.
describe('TicketsPage (#1144)', () => {
  test('its header is the other pages\' header: the same title and line under it, with its count beside the title; the line says whose backlog shows', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ title: 'Do the thing' })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Do the other thing' })] },
    ])
    render()
    await screen.findByText('Do the thing')
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe('Tickets2/2')
    expect(title.className).toBe('text-lg font-semibold')
    const line = title.nextElementSibling!
    expect(line.textContent).toBe('Every project\u2019s tickets/ backlog: what agents plan from.')
    expect(line.className).toBe('mt-1 text-sm text-muted-foreground')
    // No bar of its own under the header.
    expect(title.closest('.border-b')).toBeNull()
    cleanup()
    // With one project shown, the line does not say "every".
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ title: 'Do the thing' })] }])
    render()
    await screen.findByText('Do the thing')
    expect(screen.getByRole('heading', { level: 1 }).nextElementSibling!.textContent).toBe('This project\u2019s tickets/ backlog: what agents plan from.')
  })

  test('reads every project\'s tickets and lists each under its own project heading', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ title: 'Do the thing' })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Do the other thing' })] },
    ])
    render()
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Do the thing')).toBeTruthy()
    expect(screen.getByText('Do the other thing')).toBeTruthy()
  })

  test('opening a row hands back its project and file, for the detail route (#1144)', async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [ticket()] }])
    render()
    fireEvent.click(await screen.findByText('Do the thing'))
    // The module's own page for that ticket: where the dashboard's link convention sends a link to it.
    expect(host.openPage).toHaveBeenCalledWith('tickets', ['t.md'], 'p1')
  })

  test('a project with no tickets still offers its own update, not a dead end', async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [] }])
    render()
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update tickets' })).toBeTruthy()
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
    expect(screen.getByRole('alert').textContent).toMatch(/Could not read the tickets of Beta: no answer for p2/)
  })

  test('a claim naming one of the project\'s runs reads as its session name and opens the run (#1748)', async () => {
    const run = { id: '2026-08-30T10-00-00-000Z', name: 'login-page', status: 'running' as const, startedAt: '2026-08-30T10:00:00.000Z' }
    host = fakeHost({ p1: { 'list --local': [ticket({ locked: true, lockedBy: run.id })], 'meta --local': {} } }, { p1: [run] })
    renderWithHost(<TicketsPage projects={[{ id: 'p1', name: 'Alpha', gitHost: true }]} />, host, modules())
    fireEvent.click(await screen.findByText('login-page'))
    expect(host.openAgent).toHaveBeenCalledWith('p1', run.id)
  })
})

// The sort menu (#1144/#1265): the server already hands back newest-first, so the default Date ↓
// keeps its order; "Priority" re-sorts client-side, ties falling back to newest-first.
describe('TicketsPage sort (#1144/#1265)', () => {
  const twoByPriority = () =>
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          ticket({ file: 'low.md', title: 'Low priority', priority: '2' }),
          ticket({ file: 'high.md', title: 'High priority', priority: '9' }),
        ],
      },
    ])

  test('defaults to the server\'s date order', async () => {
    twoByPriority()
    render()
    await screen.findByText('Low priority')
    const titles = screen.getAllByRole('button').map(b => b.textContent)
    // 'low.md' is first in the fixture, standing in for "whatever order the server sent" — the
    // default sort must not have reordered it.
    expect(titles.findIndex(t => t?.includes('Low priority'))).toBeLessThan(titles.findIndex(t => t?.includes('High priority')))
  })

  test('sorting by priority puts the highest first, and lands in the URL', async () => {
    twoByPriority()
    render()
    await screen.findByText('Low priority')
    fireEvent.click(screen.getByRole('button', { name: /sort: date/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Priority' }))
    const titles = (await screen.findAllByRole('button')).map(b => b.textContent)
    expect(titles.findIndex(t => t?.includes('High priority'))).toBeLessThan(titles.findIndex(t => t?.includes('Low priority')))
    expect(window.location.search).toBe('?sort=priority')
  })

  test('a priority tie falls back to newest first, not an arbitrary order', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          // Server order is already newest-first; both name the same priority.
          ticket({ file: 'newer.md', title: 'Newer', priority: '5', date: '2026-02-01T00:00:00.000Z' }),
          ticket({ file: 'older.md', title: 'Older', priority: '5', date: '2026-01-01T00:00:00.000Z' }),
        ],
      },
    ])
    render()
    await screen.findByText('Newer')
    fireEvent.click(screen.getByRole('button', { name: /sort: date/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Priority' }))
    const titles = (await screen.findAllByRole('button')).map(b => b.textContent)
    expect(titles.findIndex(t => t?.includes('Newer'))).toBeLessThan(titles.findIndex(t => t?.includes('Older')))
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

  test('searching narrows the rows and writes q= to the URL', async () => {
    fixture()
    render()
    await screen.findByText('Improve the lock')
    // The shown/total tally sits beside the page title, full pool while unfiltered.
    expect(screen.getByText('2/2')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: /search tickets/i }), { target: { value: 'lock' } })
    await waitFor(() => expect(screen.queryByText('Something else')).toBeNull())
    expect(screen.getByText('Improve the lock')).toBeTruthy()
    expect(screen.getByText('1/2')).toBeTruthy()
    expect(window.location.search).toBe('?q=lock')
  })

  test('the URL is the initial state: mounting under ?q= starts filtered', async () => {
    fixture()
    window.history.replaceState(null, '', '/tickets?q=lock')
    render()
    expect(await screen.findByText('Improve the lock')).toBeTruthy()
    expect(screen.queryByText('Something else')).toBeNull()
  })

  test('clicking a row\'s topic badge adds that topic filter (#1144)', async () => {
    fixture()
    render()
    await screen.findByText('Improve the lock')
    fireEvent.click(screen.getByRole('button', { name: 'dx' }))
    await waitFor(() => expect(screen.queryByText('Something else')).toBeNull())
    expect(window.location.search).toBe('?topics=dx')
  })

  test('a badge whose topic is capitalised filters by it just the same', async () => {
    // Matching lowercases the ticket's topics, so an `UX` badge added verbatim matched nothing —
    // clicking it emptied the page instead of narrowing it.
    fixture([ticket({ file: 'ux.md', title: 'Polish the rail', topics: ['UX'] }), ticket({ file: 'other.md', title: 'Something else' })])
    render()
    await screen.findByText('Polish the rail')
    fireEvent.click(screen.getByRole('button', { name: 'UX' }))
    await waitFor(() => expect(screen.queryByText('Something else')).toBeNull())
    expect(screen.getByText('Polish the rail')).toBeTruthy()
    expect(window.location.search).toBe('?topics=ux')
  })

  test('clicking the claim marker narrows to claimed tickets', async () => {
    fixture()
    render()
    await screen.findByText('Something else')
    fireEvent.click(screen.getByText('agent-1'))
    await waitFor(() => expect(screen.queryByText('Improve the lock')).toBeNull())
    expect(screen.getByText('Something else')).toBeTruthy()
    expect(window.location.search).toBe('?stage=claimed')
  })

  test('a project filtered to nothing says so and clears from right there', async () => {
    fixture()
    window.history.replaceState(null, '', '/tickets?q=zzz-no-match')
    render()
    expect(await screen.findByText(/2 tickets hidden by the current filters/i)).toBeTruthy()
    // Not the update offer — these tickets exist, they are filtered (#1230's rule, kept).
    expect(screen.queryByRole('button', { name: 'Update tickets' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(await screen.findByText('Improve the lock')).toBeTruthy()
    expect(window.location.search).toBe('')
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
    const titles = (await screen.findAllByRole('button')).map(b => b.textContent)
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
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Beta ticket' })] },
    ])
    window.history.replaceState(null, '', '/tickets?group=none')
    render()
    fireEvent.click(await screen.findByRole('button', { name: /start work on beta ticket/i }))
    // The row's own project, not a panel-bound one — the flat list carries one per row.
    await waitFor(() => expect(started()).toEqual([['p2', workOnTicketPrompt('b.md')]]))
  })

  test("a flat row's Configure first opens that row's own project's launcher (#1507)", async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'Alpha ticket' })] },
      { projectId: 'p2', projectName: 'Beta', tickets: [ticket({ file: 'b.md', title: 'Beta ticket' })] },
    ])
    window.history.replaceState(null, '', '/tickets?group=none')
    render()
    await configureFirst('Other ways to work on Beta ticket')
    // The row's own project, not the first one the page happens to list.
    await waitFor(() => expect(host.configureRun).toHaveBeenCalledWith('p2', workOnTicketPrompt('b.md')))
    expect(host.startRun).not.toHaveBeenCalled()
  })
})

// The page-wide queue-add button: the detail page's Queue action lifted to the page's heading —
// every unclaimed shown ticket is handed to the queue's action (what is already queued is the
// action's own to skip), and no agent starts: the queue's own consumers do that.
describe('TicketsPage add the shown set to the AI queue', () => {
  test('every shown ticket joins the queue, and the button rests as Queued until the set changes', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [ticket({ file: 'a.md', title: 'First', priority: '7' }), ticket({ file: 'b.md', title: 'Second' })],
      },
    ])
    await controls()
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue: all 2 tickets shown below' }))
    // Queued exactly as the detail page's Queue button queues (#1164): title as the entry, the
    // ticket named so the entry links back, its priority picking the section.
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1))
    expect(handed('p1')).toEqual([[link('First', 'a.md', 7), link('Second', 'b.md')]])
    // Queueing is the whole act — the queue's own consumers start agents, not this button.
    expect(host.startRun).not.toHaveBeenCalled()
    // Done, the button says so and rests for this exact set…
    const queued = await screen.findByRole('button', { name: 'Queued' })
    expect((queued as HTMLButtonElement).disabled).toBe(true)
    // …and narrowing the shown set arms it again, counting the new set.
    fireEvent.change(screen.getByRole('textbox', { name: /search tickets/i }), { target: { value: 'First' } })
    expect(await screen.findByRole('button', { name: 'Add to queue: the ticket shown below' })).toBeTruthy()
  })

  test('claimed tickets are left to the agents holding them, and the label says so', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [ticket({ file: 'a.md', title: 'First' }), ticket({ file: 'b.md', title: 'Second', locked: true, lockedBy: 'agent-1' })],
      },
    ])
    await controls()
    render()
    // The label counts only what the click will add, never promising the claimed row.
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue: the one ready ticket shown below' }))
    await screen.findByRole('button', { name: 'Queued' })
    expect(handed('p1')).toEqual([[link('First', 'a.md')]])
  })

  test('tickets in review or waiting are left out of both adds, and the label says so', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue: a plan for the one unplanned ticket shown below' }))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1))
    expect(handed('p1')).toEqual([[plan('a.md')]])
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: the one ready ticket shown below' }))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(2))
    expect(handed('p1')).toEqual([[plan('a.md')], [link('First', 'a.md')]])
  })

  test('a set of tickets all in review or waiting is not an offer, selected or not', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          ticket({ file: 'b.md', title: 'Second', pr: { label: '#12', url: 'https://example.com/pull/12' } }),
          ticket({ file: 'c.md', title: 'Third', waiting: 'the vendor' }),
        ],
      },
    ])
    await controls()
    render()
    await screen.findByText('Second')
    expect(screen.queryByRole('button', { name: /add to queue:/i })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }))
    expect(screen.queryByRole('button', { name: /add to queue:/i })).toBeNull()
  })

  test('nothing shown, no buttons: an empty shown set is not an offer', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'First' })] },
    ])
    window.history.replaceState(null, '', '/tickets?q=zzz-no-match')
    render()
    await screen.findByText(/1 ticket hidden by the current filters/i)
    expect(screen.queryByRole('button', { name: /add to queue: (the|all)/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /add to queue: plans for/i })).toBeNull()
  })

  test('every shown ticket claimed, no buttons: the whole set is already being worked', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'First', locked: true })] },
    ])
    render()
    await screen.findByText('First')
    expect(screen.queryByRole('button', { name: /add to queue: (the|all)/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /add to queue: a plan for/i })).toBeNull()
  })
})

// The plan sibling of the queue-add: one `Create tickets/<stem>.plan.md` entry per shown ticket
// still to plan, placed by the ticket's priority — and no
// agent starts here either.
describe('TicketsPage queue plans for the shown set', () => {
  test('every shown ticket still to plan gets its plan queued, and the button rests as Plans queued', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [ticket({ file: 'a.md', title: 'First', priority: '7' }), ticket({ file: 'b.md', title: 'Second' })],
      },
    ])
    await controls()
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue: plans for all 2 tickets shown below' }))
    // One plan ask per ticket, the ticket named with its priority so the entry lands in its
    // section — and neither an implementation entry nor an agent comes out of this button.
    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1))
    expect(handed('p1')).toEqual([[plan('a.md', 7), plan('b.md')]])
    expect(host.startRun).not.toHaveBeenCalled()
    const rested = await screen.findByRole('button', { name: 'Queued' })
    expect((rested as HTMLButtonElement).disabled).toBe(true)
  })

  test('planned and claimed tickets are skipped, and the label counts only what is left to plan', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue: a plan for the one unplanned ticket shown below' }))
    await screen.findByRole('button', { name: 'Queued' })
    expect(handed('p1')).toEqual([[plan('a.md')]])
  })

  test('every shown ticket planned already, no plan button — the queue-add still offers', async () => {
    onAllTickets.mockResolvedValue([
      { projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'First', planned: true })] },
    ])
    render()
    await screen.findByText('First')
    expect(screen.queryByRole('button', { name: /add to queue: (a plan|plans) for/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add to queue: the ticket shown below' })).toBeTruthy()
  })

  test('no module offering an action on links, no add buttons at all (#1774)', async () => {
    onAllTickets.mockResolvedValue([{ projectId: 'p1', projectName: 'Alpha', tickets: [ticket({ file: 'a.md', title: 'First' })] }])
    render(modules([]))
    await screen.findByText('First')
    expect(screen.queryByRole('button', { name: /add to queue/i })).toBeNull()
  })
})

// Row selection (the list idiom of issue trackers): every row carries a checkbox, and while any is ticked the
// heading's queue buttons speak for — and act on — just the selected tickets.
describe('TicketsPage selection scopes the queue buttons', () => {
  const threeTickets = () =>
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          ticket({ file: 'a.md', title: 'First', priority: '7' }),
          ticket({ file: 'b.md', title: 'Second' }),
          ticket({ file: 'c.md', title: 'Third' }),
        ],
      },
    ])

  test('selected tickets are what the queue-add adds — the rest of the shown set stays put', async () => {
    threeTickets()
    await controls()
    render()
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Third' }))
    expect(screen.getByText('2 selected')).toBeTruthy()
    // The label stops speaking for the shown set and counts the selection instead.
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: the 2 selected tickets' }))
    await screen.findByRole('button', { name: 'Queued' })
    expect(handed('p1')).toEqual([[link('First', 'a.md', 7), link('Third', 'c.md')]])
    // Changing the selection is changing the set: the rested button arms again for the new one.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }))
    expect(await screen.findByRole('button', { name: 'Add to queue: the 3 selected tickets' })).toBeTruthy()
  })

  test('the plan button narrows to the selection the same way', async () => {
    threeTickets()
    await controls()
    render()
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: a plan for the selected ticket' }))
    await screen.findByRole('button', { name: 'Queued' })
    expect(handed('p1')).toEqual([[plan('b.md')]])
  })

  test('clearing the selection hands the buttons back to the whole shown set', async () => {
    threeTickets()
    render()
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First' }))
    expect(screen.getByRole('button', { name: 'Add to queue: the selected ticket' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByText(/selected/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Add to queue: all 3 tickets shown below' })).toBeTruthy()
  })

  test('a claimed ticket in the selection is still skipped, and the label counts without it', async () => {
    onAllTickets.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        tickets: [
          ticket({ file: 'a.md', title: 'First' }),
          ticket({ file: 'b.md', title: 'Second', locked: true, lockedBy: 'agent-1' }),
        ],
      },
    ])
    await controls()
    render()
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: the one ready selected ticket' }))
    await screen.findByRole('button', { name: 'Queued' })
    expect(handed('p1')).toEqual([[link('First', 'a.md')]])
  })

  test('a selected ticket the filters hide is neither counted nor acted on, and stays selected', async () => {
    threeTickets()
    await controls()
    render()
    await screen.findByText('Second')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }))
    // Hide the selected row: the selection has nothing shown, so the buttons speak for the
    // shown set again and the selection readout goes quiet.
    fireEvent.change(screen.getByRole('textbox', { name: /search tickets/i }), { target: { value: 'First' } })
    await waitFor(() => expect(screen.queryByText('Second')).toBeNull())
    expect(screen.queryByText('1 selected')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: the ticket shown below' }))
    await screen.findByRole('button', { name: 'Queued' })
    expect(handed('p1')).toEqual([[link('First', 'a.md', 7)]])
    // The tick itself survives the filter and comes back with the row.
    fireEvent.change(screen.getByRole('textbox', { name: /search tickets/i }), { target: { value: '' } })
    const box = await screen.findByRole('checkbox', { name: 'Select Second' })
    expect(box.getAttribute('data-checked')).not.toBeNull()
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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Beta ticket' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: the selected ticket' }))
    await screen.findByRole('button', { name: 'Queued' })
    expect(addToQueue).toHaveBeenCalledTimes(1)
    expect(handed('p2')).toEqual([[link('Beta ticket', 'b.md')]])
  })
})

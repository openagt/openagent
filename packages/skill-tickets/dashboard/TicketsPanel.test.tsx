import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { useAction, useModuleHost } from '@openagt/dashboard/module'
import { configureFirst, openMenu } from '../../dashboard/dashboard/test-utils.js'
import type { MountedModules } from '../../dashboard/dashboard/lib/use-modules.js'
import { planTicketPrompt, workOnTicketPrompt } from '../src/module.js'
import type { WorkspaceTicket } from './lib/types.js'
import { fakeHost, renderWithHost, type FakeHost } from './test-host.js'
import { GROUP_BY_STAGE_FROM, ProjectTicketsPresses, TicketsPanel, type ListedTicket } from './TicketsPanel.js'

// The panel reaches the dashboard through the host: a run started with `startRun` (which lands
// on the run itself), a launcher opened with `configureRun`, and the last-update stamp read with
// `tickets meta --local`.
let meta: Record<string, unknown> = {}
let host: FakeHost
const render = (ui: ReactElement, mounted?: MountedModules) => {
  host = fakeHost({ p1: { 'meta --local': meta } })
  return renderWithHost(ui, host, mounted)
}
/** The starts the host was asked for: `[projectId, prompt]` each. */
const started = () => host.startRun.mock.calls.map(([projectId, prompt]) => [projectId, prompt])

const ticket = (over: Partial<WorkspaceTicket> = {}): WorkspaceTicket => ({
  file: '2026-07-20_do-the-thing.md',
  title: 'Do the thing',
  summary: 'The thing is not done.',
  date: '2026-01-01T00:00:00.000Z',
  planned: false,
  ...over,
})

/** One project's list as the page wires it: its starts go to the row's project, as the page's do. */
function Rows({ tickets, hiddenByFilter, isSelected, onToggleSelect, onOpen = () => {}, onTopic, onClaimed }: {
  tickets: WorkspaceTicket[]
  hiddenByFilter?: number
  isSelected?: (row: ListedTicket) => boolean
  onToggleSelect?: (row: ListedTicket) => void
  onOpen?: (row: ListedTicket) => void
  onTopic?: (topic: string) => void
  onClaimed?: () => void
}) {
  const host = useModuleHost()
  const { busy, error, run } = useAction()
  const [starting, setStarting] = useState<{ projectId: string; prompt: string } | null>(null)
  return (
    <>
      {error && <p>{error}</p>}
      <TicketsPanel
        projectId="p1"
        rows={tickets.map(t => ({ projectId: 'p1', ticket: t }))}
        {...(hiddenByFilter !== undefined ? { hiddenByFilter } : {})}
        busy={busy}
        starting={starting}
        isSelected={isSelected}
        onToggleSelect={onToggleSelect}
        onOpen={onOpen}
        onStart={async (row, prompt, failure) => {
          setStarting({ projectId: row.projectId, prompt })
          await run(() => host.startRun(row.projectId, prompt), failure)
          setStarting(null)
        }}
        onConfigure={(row, prompt) => host.configureRun(row.projectId, prompt)}
        onTopic={onTopic}
        onClaimed={onClaimed}
      />
    </>
  )
}

beforeEach(() => {
  meta = {}
})

afterEach(cleanup)

describe('the tickets list', () => {
  test('lists the tickets one a line, saying where each stands, and an agent holding one by its name under the pointer', async () => {
    render(<Rows tickets={[ticket({ priority: '8', locked: true, lockedBy: 'agent-1' })]} />)
    expect(await screen.findByText('Do the thing')).toBeTruthy()
    expect(screen.getByText('Claimed').closest('[title]')?.getAttribute('title')).toBe('Claimed by agent-1')
    // The summary is the ticket's page's; the list row is one line.
    expect(screen.queryByText('The thing is not done.')).toBeNull()
  })

  test('a ticket with a plan reads Planned, one without Unplanned', async () => {
    render(<Rows tickets={[ticket({ planned: true }), ticket({ file: 'b.md', title: 'Other' })]} />)
    expect(await screen.findByText('Planned')).toBeTruthy()
    expect(screen.getByText('Unplanned')).toBeTruthy()
  })

  test('a ticket with no plan offers Plan, which starts a session to write it (#685), and no Start', async () => {
    render(<Rows tickets={[ticket({ planned: false })]} />)
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }))
    // Exactly the exported ask — no second, hidden copy to drift from the button (#1187).
    await waitFor(() => expect(started()).toEqual([['p1', planTicketPrompt('2026-07-20_do-the-thing.md')]]))
    expect(started()[0]?.[1]).toBe('Create tickets/2026-07-20_do-the-thing.plan.md')
  })

  test('a planned ticket offers Start, which spins up an agent working on it, and no Plan', async () => {
    const onOpen = vi.fn()
    render(<Rows tickets={[ticket({ planned: true })]} onOpen={onOpen} />)
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await waitFor(() => expect(started()).toEqual([['p1', workOnTicketPrompt('2026-07-20_do-the-thing.md')]]))
    expect(started()[0]?.[1]).toBe('Work on tickets/2026-07-20_do-the-thing.md. Do not start any other ticket.')
    // A sibling of the row's link: starting must not also open the ticket.
    expect(onOpen).not.toHaveBeenCalled()
  })

  test("while a ticket's start is out, its own button spins, not another row's", async () => {
    render(<Rows tickets={[ticket(), ticket({ file: 'b.md', title: 'Other' })]} />)
    host.startRun.mockImplementation(() => new Promise(() => {}))
    const [start, other] = await screen.findAllByRole('button', { name: 'Plan' })
    fireEvent.click(start!)
    await waitFor(() => expect(start!.querySelector('.animate-spin')).not.toBeNull())
    expect(screen.getByText('Starting…').closest('button')).toBe(start)
    expect(other!.querySelector('.animate-spin')).toBeNull()
  })

  test('a ticket in review or waiting offers no start and no plan, and says why on the row', async () => {
    render(
      <Rows
        tickets={[
          ticket({ file: 'a.md', title: 'Reviewed', pr: { label: '#12', url: 'https://example.com/pull/12' } }),
          ticket({ file: 'b.md', title: 'Blocked', waiting: 'the vendor answer' }),
          ticket({ file: 'c.md', title: 'Planned too', planned: true, waiting: 'the vendor answer' }),
        ]}
      />,
    )
    expect(await screen.findByText('Reviewed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^(start|plan)$/i })).toBeNull()
    for (const title of ['Reviewed', 'Blocked', 'Planned too']) {
      expect(screen.queryByRole('button', { name: new RegExp(`other ways to (work on|plan) ${title}`, 'i') })).toBeNull()
    }
    expect(screen.getByText('In review').closest('[title]')?.getAttribute('title')).toBe('In review: #12')
    expect(screen.getAllByText('Waiting')[0]?.closest('[title]')?.getAttribute('title')).toBe('Waiting: the vendor answer')
  })

  test('a claimed ticket offers no start and no plan: an agent is on it', async () => {
    render(<Rows tickets={[ticket({ locked: true, lockedBy: 'agent-1' })]} />)
    expect(await screen.findByText('Claimed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^(start|plan)$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /other ways to (work on|plan) do the thing/i })).toBeNull()
  })

  test("a claim's mark is its run's own: pulsing and said in colour while the run works, its own still mark while it waits or once it ended; any other holder's is still", async () => {
    render(<Rows tickets={[ticket({ locked: true, lockedBy: 'r1', lockedByAgent: { id: 'r1', name: 'login-page' }, holderStatus: 'running' })]} />)
    const working = (await screen.findByText('Claimed')).closest('[title]')!
    expect(working.getAttribute('title')).toBe('Claimed by login-page')
    expect(working.querySelector('.bg-info')?.className).toContain('animate-pulse')
    expect(working.className).toContain('text-info')
    cleanup()
    render(<Rows tickets={[ticket({ locked: true, lockedBy: 'r1', lockedByAgent: { id: 'r1', name: 'login-page' }, holderStatus: 'waiting' })]} />)
    const asking = (await screen.findByText('Claimed')).closest('[title]')!
    expect(asking.querySelector('.bg-warning')?.className).not.toContain('animate')
    expect(asking.className).not.toContain('text-info')
    cleanup()
    render(<Rows tickets={[ticket({ locked: true, lockedBy: 'r1', lockedByAgent: { id: 'r1', name: 'login-page' }, holderStatus: 'done' })]} />)
    const ended = (await screen.findByText('Claimed')).closest('[title]')!
    expect(ended.querySelector('[class*="animate"]')).toBeNull()
    expect(ended.querySelector('.bg-info')).toBeNull()
    cleanup()
    render(<Rows tickets={[ticket({ locked: true, lockedBy: 'alice-laptop' })]} />)
    const other = (await screen.findByText('Claimed')).closest('[title]')!
    expect(other.querySelector('svg')).not.toBeNull()
    expect(other.querySelector('[class*="animate"]')).toBeNull()
  })

  test('topic badges filter on click when the page passes a handler, without opening the row (#1144)', async () => {
    const onOpen = vi.fn()
    const onTopic = vi.fn()
    render(<Rows tickets={[ticket({ topics: ['dx'] })]} onOpen={onOpen} onTopic={onTopic} />)
    const badge = await screen.findByRole('button', { name: 'dx' })
    expect(badge.getAttribute('title')).toBe('Filter by dx')
    fireEvent.click(badge)
    expect(onTopic).toHaveBeenCalledWith('dx')
    expect(onOpen).not.toHaveBeenCalled()
  })

  test('the claim marker filters to claimed tickets on click (#1144); a claim by one of the project\'s runs opens that run (#1748)', async () => {
    const onClaimed = vi.fn()
    const onOpen = vi.fn()
    render(<Rows tickets={[ticket({ locked: true, lockedBy: 'agent-1' })]} onOpen={onOpen} onClaimed={onClaimed} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Claimed by agent-1' }))
    expect(onClaimed).toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
    cleanup()
    render(<Rows tickets={[ticket({ locked: true, lockedBy: 'r1', lockedByAgent: { id: 'r1', name: 'login-page' }, holderStatus: 'running' })]} onClaimed={onClaimed} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Claimed by login-page' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'r1')
    expect(onClaimed).toHaveBeenCalledTimes(1)
  })

  test('rows carry a selection checkbox only when the page wires one, toggling the row without opening it', async () => {
    const onToggleSelect = vi.fn()
    const onOpen = vi.fn()
    render(<Rows tickets={[ticket()]} isSelected={() => true} onToggleSelect={onToggleSelect} onOpen={onOpen} />)
    const box = await screen.findByRole('checkbox', { name: /select do the thing/i })
    expect(box.getAttribute('data-checked')).not.toBeNull()
    fireEvent.click(box)
    expect(onToggleSelect).toHaveBeenCalledWith({ projectId: 'p1', ticket: expect.objectContaining({ file: '2026-07-20_do-the-thing.md' }) })
    expect(onOpen).not.toHaveBeenCalled()
    cleanup()
    render(<Rows tickets={[ticket()]} />)
    await screen.findByText('Do the thing')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  test('shows the row\'s facts: its priority, its topics and its age (#1144/#1265)', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
    render(<Rows tickets={[ticket({ priority: '8', topics: ['dx', 'ui'], date: twoDaysAgo })]} />)
    expect((await screen.findByText('P8')).getAttribute('title')).toBe('Priority 8')
    expect(screen.getByText('dx')).toBeTruthy()
    expect(screen.getByText('ui')).toBeTruthy()
    expect(screen.getByText('2d')).toBeTruthy()
  })

  test('the priority column is kept on every row once a ticket of the list has one, and given up when none has', async () => {
    render(<Rows tickets={[ticket({ priority: '3' }), ticket({ file: 'b.md', title: 'Other' })]} />)
    const otherRow = (await screen.findByText('Other')).closest('li')!
    expect(otherRow.querySelector('.w-6')).not.toBeNull()
    cleanup()
    render(<Rows tickets={[ticket(), ticket({ file: 'b.md', title: 'Other' })]} />)
    expect((await screen.findByText('Other')).closest('li')!.querySelector('.w-6')).toBeNull()
  })

  test('the list renders whatever order it is given (#1144)', async () => {
    render(<Rows tickets={[ticket({ file: 'older.md', title: 'Older' }), ticket({ file: 'newer.md', title: 'Newer' })]} />)
    const titles = (await screen.findAllByRole('link')).map(b => b.textContent)
    expect(titles.findIndex(t => t?.includes('Older'))).toBeLessThan(titles.findIndex(t => t?.includes('Newer')))
  })

  test('opening a row hands back the row, its file the slug the detail route uses (#1144)', async () => {
    const onOpen = vi.fn()
    render(<Rows tickets={[ticket()]} onOpen={onOpen} />)
    fireEvent.click(await screen.findByText('Do the thing'))
    expect(onOpen).toHaveBeenCalledWith({ projectId: 'p1', ticket: expect.objectContaining({ file: '2026-07-20_do-the-thing.md' }) })
  })

  test('a long list in more than one stage is grouped by stage, in the order agents take them; a short one is one card', async () => {
    const many = Array.from({ length: GROUP_BY_STAGE_FROM }, (_, i) =>
      ticket({ file: `t${i}.md`, title: `Ticket ${i}`, planned: i % 2 === 0, ...(i === 5 ? { locked: true, lockedBy: 'agent-1' } : {}) }),
    )
    render(<Rows tickets={many} />)
    const headings = (await screen.findAllByRole('heading')).map(h => h.textContent)
    expect(headings).toEqual(['Claimed', 'Planned', 'Unplanned'])
    // A part's name says its rows' stage: they do not say it again.
    const planned = screen.getByRole('region', { name: 'Planned' })
    expect(within(planned).queryByText('Planned', { selector: 'li *' })).toBeNull()
    cleanup()
    render(<Rows tickets={many.slice(0, GROUP_BY_STAGE_FROM - 1)} />)
    await screen.findByText('Ticket 0')
    expect(screen.queryAllByRole('heading')).toEqual([])
  })

  test("a row queues its next step from the start button's menu: the plan's ask with no plan, the ticket with one", async () => {
    const addToQueue = vi.fn(async () => ({ ok: true as const }))
    const mounted: MountedModules = { pages: [], cards: [], linkActions: [{ label: 'Add to queue', doneLabel: 'Queued', run: addToQueue, package: '@x/queue', projects: ['p1'] }], panels: [], runSlots: [], settings: [], everyPage: [], loaded: true }
    render(<Rows tickets={[ticket({ planned: false, priority: '8' })]} />, mounted)
    await openMenu(await screen.findByRole('button', { name: 'Other ways to plan Do the thing' }))
    fireEvent.click(await screen.findByText('Queue plan'))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: planTicketPrompt('2026-07-20_do-the-thing.md'), priority: 8 }]))
    // The row says it is queued, and starts nothing.
    expect(await screen.findByText('Queued')).toBeTruthy()
    expect(host.startRun).not.toHaveBeenCalled()
    cleanup()
    addToQueue.mockClear()
    render(<Rows tickets={[ticket({ planned: true })]} />, mounted)
    await openMenu(await screen.findByRole('button', { name: 'Other ways to work on Do the thing' }))
    fireEvent.click(await screen.findByText('Queue work'))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'Do the thing', href: 'tickets/2026-07-20_do-the-thing.md', priority: 5 }]))
  })

  test("Start work's Configure first opens the launcher with the ticket's own prompt", async () => {
    render(<Rows tickets={[ticket({ planned: true })]} />)
    await configureFirst('Other ways to work on Do the thing')
    await waitFor(() => expect(host.configureRun).toHaveBeenCalledWith('p1', workOnTicketPrompt('2026-07-20_do-the-thing.md')))
    expect(host.startRun).not.toHaveBeenCalled()
  })

  test("Plan now's Configure first carries the plan ask, not the work ask", async () => {
    render(<Rows tickets={[ticket({ planned: false })]} />)
    await configureFirst('Other ways to plan Do the thing')
    await waitFor(() => expect(host.configureRun).toHaveBeenCalledWith('p1', planTicketPrompt('2026-07-20_do-the-thing.md')))
    expect(host.startRun).not.toHaveBeenCalled()
  })

  test('an empty tickets/ says so, in one line', async () => {
    render(<Rows tickets={[]} />)
    expect(await screen.findByText('No tickets yet. Update them from the tracker, or write one.')).toBeTruthy()
  })

  test('an empty list with tickets hidden by the filters says so, and clears them from right there (#1144/#1230)', async () => {
    render(<Rows tickets={[]} hiddenByFilter={3} />)
    expect(await screen.findByText('3 tickets hidden by the filters.')).toBeTruthy()
    expect(screen.queryByText(/No tickets yet/)).toBeNull()
  })
})

describe("a project's own presses", () => {
  test('the update starts the project\'s update command (#1501)', async () => {
    render(<ProjectTicketsPresses projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
    await waitFor(() => expect(started()).toEqual([['p1', '/update-tickets']]))
  })

  test('a refused update says why (#1169)', async () => {
    render(<ProjectTicketsPresses projectId="p1" />)
    host.startRun.mockResolvedValue({ ok: false, error: 'a session is already active' })
    fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
    expect(await screen.findByText(/already active/i)).toBeTruthy()
  })

  test('beside the update, when tickets/ last caught up, read with `meta --local`, and that it never did (#1208)', async () => {
    meta = { lastImportedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() }
    render(<ProjectTicketsPresses projectId="p1" />)
    expect(await screen.findByText('Updated 3h ago')).toBeTruthy()
    expect(host.runCommand).toHaveBeenCalledWith('p1', ['meta', '--local'])
    cleanup()
    meta = {}
    render(<ProjectTicketsPresses projectId="p1" />)
    expect(await screen.findByText('Never updated')).toBeTruthy()
  })

  test('New ticket opens the page a ticket is written on', async () => {
    render(<ProjectTicketsPresses projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'New ticket' }))
    expect(host.openPage).toHaveBeenCalledWith('tickets', ['new'], 'p1')
  })
})

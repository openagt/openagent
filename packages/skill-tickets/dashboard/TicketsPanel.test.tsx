import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { configureFirst } from '../../dashboard/dashboard/test-utils.js'
import { planTicketPrompt, workOnTicketPrompt } from '../src/module.js'
import type { WorkspaceTicket } from './lib/types.js'
import { fakeHost, renderWithHost, type FakeHost } from './test-host.js'
import { TicketsPanel } from './TicketsPanel.js'

// The panel reaches the dashboard through the host: a run started with `startRun` (which lands
// on the run itself), a launcher opened with `configureRun`, and the last-import stamp read with
// `tickets meta --local`. `onTicketsMeta` is what that command answers.
let meta: Record<string, unknown> = {}
let host: FakeHost
const onTicketsMeta = { mockResolvedValue: (value: Record<string, unknown>) => (meta = value) }
const render = (ui: ReactElement) => {
  host = fakeHost({ p1: { 'meta --local': meta }, p2: { 'meta --local': meta } })
  return renderWithHost(ui, host)
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

beforeEach(() => {
  meta = {}
})

afterEach(cleanup)

describe('TicketsPanel (#697/#1144)', () => {
  test('lists the tickets as one-liners, with what has already been done to them', async () => {
    render(<TicketsPanel projectId="p1" tickets={[ticket({ priority: '8', locked: true, lockedBy: 'agent-1' })]} loaded onOpen={() => {}} />)
    expect(await screen.findByText('Do the thing')).toBeTruthy()
    // The claim marker (#1420): a hammer plus the holder, inline on the row.
    expect(screen.getByText('agent-1')).toBeTruthy()
    // The summary moved to the detail page (#1144); the list row is a one-liner.
    expect(screen.queryByText('The thing is not done.')).toBeNull()
  })

  test('the plan column links a planned ticket to its plan, by the same slug the plan route uses (#685)', async () => {
    const onOpenPlan = vi.fn()
    render(<TicketsPanel projectId="p1" tickets={[ticket({ planned: true })]} loaded onOpen={() => {}} onOpenPlan={onOpenPlan} />)
    // "planned" is no longer a badge — the column says it, and gives somewhere to go with it.
    expect(screen.queryByText('planned')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /view the plan for do the thing/i }))
    expect(onOpenPlan).toHaveBeenCalledWith('2026-07-20_do-the-thing.md')
  })

  test('the plan column starts a session to write the plan when the ticket has none (#685)', async () => {
    render(<TicketsPanel projectId="p1" tickets={[ticket({ planned: false })]} loaded onOpen={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /create a plan for do the thing/i }))
    // Exactly the exported ask — no second, hidden copy to drift from the button (#1187). The
    // dashboard starts it with the person's picks and lands on the run: nothing else to do here.
    await waitFor(() => expect(started()).toEqual([['p1', planTicketPrompt('2026-07-20_do-the-thing.md')]]))
    expect(started()[0]?.[1]).toBe('Create tickets/2026-07-20_do-the-thing.plan.md')
  })

  test('the start column spins up an agent working on the ticket', async () => {
    const onOpen = vi.fn()
    render(<TicketsPanel projectId="p1" tickets={[ticket()]} loaded onOpen={onOpen} />)
    fireEvent.click(await screen.findByRole('button', { name: /start work on do the thing/i }))
    // Exactly the exported ask — no second, hidden copy to drift from the button (#1187).
    await waitFor(() => expect(started()).toEqual([['p1', workOnTicketPrompt('2026-07-20_do-the-thing.md')]]))
    expect(started()[0]?.[1]).toBe('Work on tickets/2026-07-20_do-the-thing.md. Do not start any other ticket.')
    // A sibling of the row's open button, like the plan cell: starting must not also navigate.
    expect(onOpen).not.toHaveBeenCalled()
  })

  test('a ticket in review or waiting offers no start and no plan, and says why on the row', async () => {
    render(
      <TicketsPanel
        projectId="p1"
        tickets={[
          ticket({ file: 'a.md', title: 'Reviewed', pr: { label: '#12', url: 'https://example.com/pull/12' } }),
          ticket({ file: 'b.md', title: 'Blocked', waiting: 'the vendor answer' }),
          ticket({ file: 'c.md', title: 'Planned', planned: true, waiting: 'the vendor answer' }),
        ]}
        loaded
        onOpen={() => {}}
      />,
    )
    expect(await screen.findByText('Reviewed')).toBeTruthy()
    for (const title of ['Reviewed', 'Blocked']) {
      expect(screen.queryByRole('button', { name: new RegExp(`start work on ${title}`, 'i') })).toBeNull()
      expect(screen.queryByRole('button', { name: new RegExp(`create a plan for ${title}`, 'i') })).toBeNull()
    }
    expect(screen.getByRole('link', { name: 'In review #12' }).getAttribute('href')).toBe('https://example.com/pull/12')
    expect(screen.getAllByText('Waiting')[0]?.getAttribute('title')).toBe('Waiting: the vendor answer')
    // A plan that exists is still there to read.
    expect(screen.getByRole('button', { name: /view the plan for planned/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /start work on planned/i })).toBeNull()
  })

  test('a claimed ticket shows the hammer marker with its holder inline (#1420/#1144)', async () => {
    render(<TicketsPanel projectId="p1" tickets={[ticket({ locked: true, lockedBy: 'plan-1-0' })]} loaded onOpen={() => {}} />)
    // Inline, not tooltip-only: a still 1-2s hover is how nobody discovers anything. The tooltip
    // adds what the icon cannot say — that the agent may be planning OR implementing.
    expect(await screen.findByText('plan-1-0')).toBeTruthy()
  })

  test('rows carry a selection checkbox only when the page wires one, toggling by file without opening the row', async () => {
    const onToggleSelect = vi.fn()
    const onOpen = vi.fn()
    render(
      <TicketsPanel
        projectId="p1"
        tickets={[ticket()]}
        loaded
        isSelected={() => true}
        onToggleSelect={onToggleSelect}
        onOpen={onOpen}
       
      />,
    )
    const box = await screen.findByRole('checkbox', { name: /select do the thing/i })
    // The page said this row is picked, so the box shows it.
    expect(box.getAttribute('data-checked')).not.toBeNull()
    fireEvent.click(box)
    expect(onToggleSelect).toHaveBeenCalledWith('2026-07-20_do-the-thing.md')
    // A sibling of the row's open button, like every control here: selecting must not navigate.
    expect(onOpen).not.toHaveBeenCalled()
    cleanup()
    // Without the page's wiring — a surface with nothing to scope to a selection — no checkbox.
    render(<TicketsPanel projectId="p1" tickets={[ticket()]} loaded onOpen={() => {}} />)
    await screen.findByText('Do the thing')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  test('topic badges filter on click when the page passes a handler, without opening the row (#1144)', async () => {
    const onOpen = vi.fn()
    const onTopicClick = vi.fn()
    render(<TicketsPanel projectId="p1" tickets={[ticket({ topics: ['dx'] })]} loaded onOpen={onOpen} onTopicClick={onTopicClick} />)
    fireEvent.click(await screen.findByRole('button', { name: 'dx' }))
    expect(onTopicClick).toHaveBeenCalledWith('dx')
    // A sibling of the row's open button, like the plan cell: filtering must not also navigate.
    expect(onOpen).not.toHaveBeenCalled()
  })

  test('the claim marker filters to claimed tickets on click (#1144)', async () => {
    const onClaimedClick = vi.fn()
    render(
      <TicketsPanel
        projectId="p1"
        tickets={[ticket({ locked: true, lockedBy: 'agent-1' })]}
        loaded
        onOpen={() => {}}
        onClaimedClick={onClaimedClick}
       
      />,
    )
    fireEvent.click(await screen.findByText('agent-1'))
    expect(onClaimedClick).toHaveBeenCalled()
  })

  test('shows meta on the row: priority spelled out, topics, and a human-readable date (#1144/#1265)', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
    render(
      <TicketsPanel
        projectId="p1"
        tickets={[ticket({ priority: '8', topics: ['dx', 'ui'], date: twoDaysAgo })]}
        loaded
        onOpen={() => {}}
       
      />,
    )
    // A bare "8" would be cryptic on its own; the row spells out what it is a rating of.
    expect(await screen.findByText('Priority: 8')).toBeTruthy()
    expect(screen.getByText('dx')).toBeTruthy()
    expect(screen.getByText('ui')).toBeTruthy()
    expect(screen.getByText('2d ago')).toBeTruthy()
    // The tags fold away below sm with screen-size classes alone. With a bare `hidden` undone at
    // a width, another page's stylesheet loaded later, with its own `.hidden`, hid them for good.
    const tags = screen.getByText('dx').parentElement as HTMLElement
    expect(tags.classList.contains('max-sm:hidden')).toBe(true)
    expect(tags.classList.contains('hidden')).toBe(false)
  })

  test('sorts by date is the server\'s job — the list renders whatever order it is given (#1144)', async () => {
    // readTickets already sorts newest-first; the panel is not re-sorting behind the caller's back.
    render(
      <TicketsPanel
        projectId="p1"
        tickets={[ticket({ file: 'older.md', title: 'Older' }), ticket({ file: 'newer.md', title: 'Newer' })]}
        loaded
        onOpen={() => {}}
       
      />,
    )
    const titles = (await screen.findAllByRole('button')).map(b => b.textContent)
    expect(titles.findIndex(t => t?.includes('Older'))).toBeLessThan(titles.findIndex(t => t?.includes('Newer')))
  })

  test('links the row\'s issue out, without hijacking the row\'s own click (#1144/#1265)', async () => {
    const onOpen = vi.fn()
    render(
      <TicketsPanel
        projectId="p1"
        tickets={[ticket({ issue: { label: '#42', url: 'https://example.com/org/repo/issues/42' } })]}
        loaded
        onOpen={onOpen}
       
      />,
    )
    const link = await screen.findByRole('link', { name: /#42/ })
    expect(link.getAttribute('href')).toBe('https://example.com/org/repo/issues/42')
    // A sibling of the row's button, not a child: clicking the link must not open the detail page.
    fireEvent.click(link)
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Do the thing'))
    expect(onOpen).toHaveBeenCalledWith('2026-07-20_do-the-thing.md')
  })

  test('shows the effort the plan recorded, and keeps the row meta in priority/date/issue order (#1144/#1265)', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
    render(
      <TicketsPanel
        projectId="p1"
        tickets={[
          ticket({
            planned: true,
            effort: 2,
            uncertainty: 4,
            priority: '7',
            date: twoDaysAgo,
            issue: { label: '#42', url: 'https://example.com/org/repo/issues/42' },
          }),
        ]}
        loaded
        onOpen={() => {}}
       
      />,
    )
    expect(await screen.findByText('Effort: 2')).toBeTruthy()
    expect(screen.getByText('Uncertainty: 4')).toBeTruthy()
    // Priority sits left of the date (#1265), the date left of the issue link.
    const row = screen.getByText('Do the thing').closest('li')!
    const order = [row.textContent!.indexOf('Priority'), row.textContent!.indexOf('ago'), row.textContent!.indexOf('#42')]
    expect(order.every(i => i !== -1)).toBe(true)
    expect(order[0]).toBeLessThan(order[1]!)
    expect(order[1]).toBeLessThan(order[2]!)
  })

  test('opening a row hands back its file, the slug the detail route uses (#1144)', async () => {
    const onOpen = vi.fn()
    render(<TicketsPanel projectId="p1" tickets={[ticket()]} loaded onOpen={onOpen} />)
    fireEvent.click(await screen.findByText('Do the thing'))
    expect(onOpen).toHaveBeenCalledWith('2026-07-20_do-the-thing.md')
  })

  test('an empty tickets/ offers the update instead of a dead end (#1501)', async () => {
    render(<TicketsPanel projectId="p1" tickets={[]} loaded onOpen={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
    // The project's own command, under the one label every surface offers it by.
    await waitFor(() => expect(started()).toEqual([['p1', '/update-tickets']]))
  })

  test('a refused update says why (#1169)', async () => {
    render(<TicketsPanel projectId="p1" tickets={[]} loaded onOpen={() => {}} />)
    host.startRun.mockResolvedValue({ ok: false, error: 'a session is already active' })
    fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
    expect(await screen.findByText(/already active/i)).toBeTruthy()
  })

  test('a filled tickets/ offers the same update beside the stamp (#1208)', async () => {
    render(<TicketsPanel projectId="p1" tickets={[ticket()]} loaded onOpen={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
    await waitFor(() => expect(started()).toEqual([['p1', '/update-tickets']]))
  })

  test('the empty state offers exactly one update button, without the stamp row (#1501)', async () => {
    render(<TicketsPanel projectId="p1" tickets={[]} loaded onOpen={() => {}} />)
    // One button, one command: the stamp row and its sibling button belong to the filled panel.
    expect((await screen.findAllByRole('button', { name: 'Update tickets' })).length).toBe(1)
    expect(screen.queryByText(/No record of an import yet/i)).toBeNull()
  })

  test('the stamp says when tickets/ last caught up, read with `meta --local`, and admits when it does not know (#1208)', async () => {
    onTicketsMeta.mockResolvedValue({ lastImportedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() })
    render(<TicketsPanel projectId="p1" tickets={[ticket()]} loaded onOpen={() => {}} />)
    expect(await screen.findByText('Updated from the tracker 3h ago')).toBeTruthy()
    expect(host.runCommand).toHaveBeenCalledWith('p1', ['meta', '--local'])
    cleanup()
    // A repo imported before the stamp existed has none, and saying so beats inventing a date.
    onTicketsMeta.mockResolvedValue({})
    render(<TicketsPanel projectId="p1" tickets={[ticket()]} loaded onOpen={() => {}} />)
    expect(await screen.findByText('No record of an import yet')).toBeTruthy()
  })

  test('a refused update on the filled panel says why too (#1208)', async () => {
    render(<TicketsPanel projectId="p1" tickets={[ticket()]} loaded onOpen={() => {}} />)
    host.startRun.mockResolvedValue({ ok: false, error: 'a session is already active' })
    fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
    expect(await screen.findByText(/already active/i)).toBeTruthy()
  })

  // #1507: every start on this panel spends an agent on a model and a run target that live in
  // the Global options, a page away — so each carries the chevron that opens the launcher instead.
  test("the start column's Configure first opens the launcher with the ticket's own prompt", async () => {
    render(<TicketsPanel projectId="p1" tickets={[ticket()]} loaded onOpen={() => {}} />)
    await configureFirst('Other ways to work on Do the thing')
    await waitFor(() => expect(host.configureRun).toHaveBeenCalledWith('p1', workOnTicketPrompt('2026-07-20_do-the-thing.md')))
    // The launcher, not an agent — that is the whole reason this half exists.
    expect(host.startRun).not.toHaveBeenCalled()
  })

  test("the plan column's Configure first carries the plan ask, not the work ask", async () => {
    render(<TicketsPanel projectId="p1" tickets={[ticket({ planned: false })]} loaded onOpen={() => {}} />)
    await configureFirst('Other ways to plan Do the thing')
    // The shared plan sentence, so the launcher opens with the very ask the button would have sent.
    await waitFor(() => expect(host.configureRun).toHaveBeenCalledWith('p1', planTicketPrompt('2026-07-20_do-the-thing.md')))
    expect(host.startRun).not.toHaveBeenCalled()
  })

  test('a plan that already exists is a link, so it has no chevron to configure', async () => {
    render(<TicketsPanel projectId="p1" tickets={[ticket({ planned: true })]} loaded onOpen={() => {}} onOpenPlan={() => {}} />)
    expect(await screen.findByRole('button', { name: 'View the plan for Do the thing' })).toBeTruthy()
    // Reading a file starts nothing, so there is nothing to set up first.
    expect(screen.queryByRole('button', { name: 'Other ways to plan Do the thing' })).toBeNull()
  })

  test("the update's Configure first carries the update command, from either state (#1501)", async () => {
    // The filled panel's stamp row.
    render(<TicketsPanel projectId="p1" tickets={[ticket()]} loaded onOpen={() => {}} />)
    await configureFirst('Other ways to update the tickets')
    await waitFor(() => expect(host.configureRun).toHaveBeenCalledWith('p1', '/update-tickets'))
    cleanup()
    // And the empty panel's own button, which offers the same command under the same label.
    render(<TicketsPanel projectId="p1" tickets={[]} loaded onOpen={() => {}} />)
    await configureFirst('Other ways to update the tickets')
    await waitFor(() => expect(host.configureRun).toHaveBeenCalledWith('p1', '/update-tickets'))
    expect(host.startRun).not.toHaveBeenCalled()
  })

  test('an empty list with hiddenByFilter says so, rather than offering an update for work already done (#1144/#1230)', async () => {
    render(<TicketsPanel projectId="p1" tickets={[]} loaded hiddenByFilter={3} onOpen={() => {}} />)
    expect(await screen.findByText(/3 tickets hidden by the current filter/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Update tickets' })).toBeNull()
  })

  test('no project renders nothing at all', () => {
    const { container } = render(<TicketsPanel projectId={null} tickets={[]} loaded onOpen={() => {}} />)
    expect(container.textContent).toBe('')
  })
})

test('a claim naming one of the project\'s agents shows its session name and opens the agent (#1748)', () => {
  const opened: string[] = []
  render(
    <TicketsPanel
      projectId="p1"
      tickets={[ticket({ locked: true, lockedBy: '2026-08-30T10-00-00-000Z', lockedByAgent: { id: '2026-08-30T10-00-00-000Z', name: 'login-page' } })]}
      loaded
      onOpen={() => {}}
     
      onOpenAgent={id => opened.push(id)}
    />,
  )
  fireEvent.click(screen.getByText('login-page'))
  expect(opened).toEqual(['2026-08-30T10-00-00-000Z'])
  // A holder the project has no record of is shown as written, and opens nothing.
  render(<TicketsPanel projectId="p2" tickets={[ticket({ file: 'other.md', locked: true, lockedBy: 'claude/some-session' })]} loaded onOpen={() => {}} onOpenAgent={id => opened.push(id)} />)
  expect(screen.getByText('claude/some-session')).toBeTruthy()
})

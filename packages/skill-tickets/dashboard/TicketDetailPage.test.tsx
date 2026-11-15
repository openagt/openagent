import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { openMenu } from '../../dashboard/dashboard/test-utils.js'
import type { ReactElement } from 'react'
import { forgetRemembered, type ModuleAgent } from '@openagt/dashboard/module'
import type { MountedModules } from '@openagt/dashboard/module/testing'
import { fakeHost, renderWithHost, type FakeHost } from './test-host.js'
import { TicketDetailPage } from './TicketDetailPage.js'
import { planTicketPrompt, workOnTicketPrompt } from '../src/module.js'

// The page reads one ticket with `tickets show <file> --local` through the host, and lifts a
// claim with `tickets release <file> --force` as an act. `onTicket` is what the command answers:
// the ticket, or `null` for the command's refusal (no such ticket).
let shown: Record<string, unknown> | null = null
let agents: ModuleAgent[] = []
let released: { ok: true } | { ok: false; error: string } = { ok: true }
let host: FakeHost
const onTicket = { mockResolvedValue: (value: Record<string, unknown> | null) => (shown = value) }
const sendReleaseTicketLock = { mockResolvedValue: (value: { ok: true } | { ok: false; error: string }) => (released = value) }

// The one link action an installed module offers here (#1774): a queue package's "Add to queue",
// present in project p1. Its `run` is the spy the queueing tests read.
const addToQueue = vi.fn()
const modules = (projects: string[] = ['p1']): MountedModules => ({
  pages: [],
  cards: [],
  linkActions: [{ label: 'Add to queue', doneLabel: 'Queued', run: addToQueue, package: '@x/queue', projects }],
  panels: [],
  runSlots: [],
  settings: [],
  everyPage: [],
  loaded: true,
})
const render = (ui: ReactElement, mounted: MountedModules = modules()) => {
  const slug = (ui.props as { slug: string }).slug
  host = fakeHost(shown ? { p1: { [`show ${slug} --local`]: { ok: true, ticket: shown } } } : {}, { p1: agents })
  // The command refuses a ticket it does not have: the page is handed the line the refusal leaves, as the dashboard runs it.
  if (!shown) host.runCommand.mockImplementation(async () => ({ ok: false, error: `no ticket tickets/${slug}` }))
  host.act.mockImplementation(async (_projectId, args) => {
    expect(args).toEqual(['release', slug, '--force'])
    return released.ok ? { ok: true, output: { ok: true, file: `tickets/${slug}` } } : released
  })
  return renderWithHost(ui, host, mounted)
}

/** Queue the ticket's next step: its start button's menu, then the item. */
const queueFromMenu = async (menu: string, item: string) => {
  await openMenu(await screen.findByRole('button', { name: menu }))
  fireEvent.click(await screen.findByText(item))
}
/** Lift the claim: More, then its item. */
const releaseFromMenu = async () => {
  await openMenu(await screen.findByRole('button', { name: 'More' }))
  fireEvent.click(await screen.findByText('Release the claim'))
}

const ticket = (over: Record<string, unknown> = {}) => ({
  file: '2026-07-20_do-the-thing.md',
  title: 'Do the thing',
  summary: 'The thing is not done.',
  date: '2026-01-01T00:00:00.000Z',
  planned: false,
  content: '# Do the thing\n\n## TLDR\n\nThe thing is not done.\n\nMore detail below the fold.',
  ...over,
})

afterEach(() => {
  cleanup()
  // Every story reads the same ticket: none opens on the one before's.
  forgetRemembered()
  localStorage.clear()
  shown = null
  agents = []
  released = { ok: true }
  addToQueue.mockReset()
})

// One ticket's own page (#1144): the entire file, read by the same slug the list row and the
// route carry, plus the actions on it the one-liner list no longer has room for.
describe('TicketDetailPage (#1144)', () => {
  test('a ticket read before opens on that read at once, not on Loading', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByRole('heading', { name: 'Do the thing' })).toBeTruthy()
    cleanup()
    // Open again, the read still on its way.
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    host.runCommand.mockImplementation(() => new Promise(() => {}))
    expect(screen.getByRole('heading', { name: 'Do the thing' })).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  test('reads the ticket by slug and renders its text below the title, the title, the keys above it and its summary said once', async () => {
    onTicket.mockResolvedValue(ticket({ priority: '8', planned: true, content: 'Priority: 8\n\n# Do the thing\n\n## TLDR\n\nThe thing is not done.\n\nMore detail below the fold.' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByText('More detail below the fold.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Do the thing' })).toBeTruthy()
    // The heading, and the breadcrumb's last step: the text never says it again.
    expect(screen.getAllByText('Do the thing')).toHaveLength(2)
    expect(screen.getAllByText('The thing is not done.')).toHaveLength(1)
    expect(screen.queryByText('Priority: 8', { selector: 'p' })).toBeNull()
    // A bare "8" would be cryptic on its own (#1265); the badge spells out what it rates.
    expect(screen.getByText('Priority 8')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Plan' })).toBeTruthy()
    expect(host.runCommand).toHaveBeenCalledWith('p1', ['show', '2026-07-20_do-the-thing.md', '--local'])
  })

  test('shows the issue link, then the date, then the priority under the title (#1144/#1265)', async () => {
    onTicket.mockResolvedValue(ticket({ priority: '3', issue: { label: '#42', url: 'https://example.com/org/repo/issues/42' } }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    const meta = (await screen.findByText(/ ago$/)).parentElement!
    const order = [meta.textContent?.indexOf('#42'), meta.textContent?.indexOf('ago'), meta.textContent?.indexOf('Priority')]
    expect(order.every(i => i !== undefined && i !== -1)).toBe(true)
    expect(order[0]).toBeLessThan(order[1] as number)
    expect(order[1]).toBeLessThan(order[2] as number)
    const link = screen.getByRole('link', { name: /#42/ })
    expect(link.getAttribute('href')).toBe('https://example.com/org/repo/issues/42')
  })

  test('shows the date first in the meta under the title (#1144/#1265)', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
    // Named with no day, it is dated by its file: two days ago.
    onTicket.mockResolvedValue(ticket({ file: 'do-the-thing.md', date: twoDaysAgo }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    const meta = (await screen.findByText('2d ago')).parentElement!
    expect(meta.textContent?.startsWith('2d ago')).toBe(true)
  })

  test('a ticket in review or waiting is never offered to the queue, and says which', async () => {
    onTicket.mockResolvedValue(ticket({ pr: { label: '#12', url: 'https://example.com/pull/12' } }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByText(/In review/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Queue / })).toBeNull()
    cleanup()
    onTicket.mockResolvedValue(ticket({ waiting: 'the vendor answer' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByText(/the vendor answer/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Queue / })).toBeNull()
  })

  test('the Plan tab of a ticket with no plan is named as it reads: "Plan, none yet"', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByRole('tab', { name: 'Plan, none yet' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Ticket' })).toBeTruthy()
  })

  test('shows the effort and uncertainty the plan recorded, with the rest of the meta (#1144/#1265)', async () => {
    onTicket.mockResolvedValue(ticket({ planned: true, effort: 2, uncertainty: 0 }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByText('Effort 2/10')).toBeTruthy()
    expect(screen.getByText('Uncertainty 0/10')).toBeTruthy()
  })

  test('a planned ticket is handed as a link to the module\'s action, at the priority its own says (#1164/#1774)', async () => {
    onTicket.mockResolvedValue(ticket({ planned: true, priority: '8' }))
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await queueFromMenu('Other ways to work on Do the thing', 'Add to queue')
    // The title as the link, pointing back at the ticket's file, its priority as a number on the
    // queue's own 0–10 scale.
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'Do the thing', href: 'tickets/2026-07-20_do-the-thing.md', priority: 8 }]))
  })

  test('a ticket with no priority is handed over at 5, the middle of the scale', async () => {
    onTicket.mockResolvedValue(ticket({ planned: true }))
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await queueFromMenu('Other ways to work on Do the thing', 'Add to queue')
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'Do the thing', href: 'tickets/2026-07-20_do-the-thing.md', priority: 5 }]))
  })

  test('a ticket with no plan queues the ask for its plan, not the work', async () => {
    onTicket.mockResolvedValue(ticket({ priority: '8' }))
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByRole('button', { name: 'Plan now' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull()
    await queueFromMenu('Other ways to plan Do the thing', 'Add to queue')
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'Create tickets/2026-07-20_do-the-thing.plan.md', priority: 8 }]))
  })

  test('a queued ticket says so and cannot be queued twice', async () => {
    onTicket.mockResolvedValue(ticket())
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await queueFromMenu('Other ways to plan Do the thing', 'Add to queue')
    expect(await screen.findByText('Queued')).toBeTruthy()
    // Its item in the menu now says so, and cannot be pressed again.
    await openMenu(screen.getByRole('button', { name: 'Other ways to plan Do the thing' }))
    const item = (await screen.findAllByText('Queued')).find(el => el.closest('[role="menuitem"]'))
    expect(item?.closest('[role="menuitem"]')?.getAttribute('aria-disabled')).toBe('true')
  })

  test('a ticket already on the queue opens as Queued, its menu item off: the module reads it so', async () => {
    onTicket.mockResolvedValue(ticket())
    const onQueue = { ...modules().linkActions[0]!, done: async () => (link: { text: string }) => link.text === 'Create tickets/2026-07-20_do-the-thing.plan.md' }
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />, { ...modules(), linkActions: [onQueue] })
    expect(await screen.findByText('Queued')).toBeTruthy()
    await openMenu(screen.getByRole('button', { name: 'Other ways to plan Do the thing' }))
    const item = (await screen.findAllByText('Queued')).find(el => el.closest('[role="menuitem"]'))
    expect(item?.closest('[role="menuitem"]')?.getAttribute('aria-disabled')).toBe('true')
    expect(addToQueue).not.toHaveBeenCalled()
  })

  test('a failed action surfaces its reason and leaves the button addable', async () => {
    onTicket.mockResolvedValue(ticket())
    addToQueue.mockResolvedValue({ ok: false, error: 'the queue could not be written' })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await queueFromMenu('Other ways to plan Do the thing', 'Add to queue')
    expect(await screen.findByText(/could not be written/i)).toBeTruthy()
    expect(screen.queryByText('Queued')).toBeNull()
  })

  test('no module offering an action on links in this project, no button (#1774)', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />, modules(['p2']))
    await screen.findByRole('heading', { name: 'Do the thing' })
    await openMenu(screen.getByRole('button', { name: 'Other ways to plan Do the thing' }))
    expect(await screen.findByText('Configure first, then run')).toBeTruthy()
    expect(screen.queryByText('Add to queue')).toBeNull()
  })

  test('a missing ticket says so rather than rendering blank', async () => {
    onTicket.mockResolvedValue(null)
    render(<TicketDetailPage projectId="p1" slug="gone.md" />)
    expect(await screen.findByText(/does not exist/i)).toBeTruthy()
  })

  test('a claimed ticket shows its badge, holder, and a release button (#1420)', async () => {
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'plan-1-0' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findByText(/Claimed/)
    // The holder reads inline so a human knows whose claim they are about to lift — the detail
    // page has the room, no tooltip hunt needed.
    expect(screen.getByText(/· plan-1-0/)).toBeTruthy()
    await openMenu(screen.getByRole('button', { name: 'More' }))
    expect(await screen.findByText('Release the claim')).toBeTruthy()
    // Not queued while claimed: the agent the queue hands it to would find it taken.
    expect(screen.queryByRole('button', { name: /^Queue / })).toBeNull()
  })

  test('an unclaimed ticket offers no release (#1420)', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findByRole('heading', { name: 'Do the thing' })
    expect(screen.queryByText(/Claimed/)).toBeNull()
    expect(screen.queryByText(/Claimed/)).toBeNull()
  })

  test('releasing runs `release --force` as an act and withdraws the claim without waiting for the next poll (#1420)', async () => {
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'plan-1-0' }))
    sendReleaseTicketLock.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await releaseFromMenu()
    // An act, not a read: the dashboard syncs the branch and reads the lifted lock back at once.
    await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['release', '2026-07-20_do-the-thing.md', '--force']))
    expect(host.runCommand).not.toHaveBeenCalledWith('p1', expect.arrayContaining(['release']))
    await waitFor(() => expect(screen.queryByText('claimed')).toBeNull())
    expect(screen.queryByText(/Claimed/)).toBeNull()
    // Released, it is a ticket like any other: it may be queued.
    expect(screen.getByRole('button', { name: 'Plan now' })).toBeTruthy()
  })

  test('releasing a claim whose run is at work asks first; released, the focus is on the ticket\'s title', async () => {
    agents = [{ id: 'run-1', name: 'login-page', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'run-1' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findAllByText(/at work/)
    await releaseFromMenu()
    expect(host.act).not.toHaveBeenCalled()
    // The run is named as a run, not as the sentence's first word.
    expect((await screen.findByRole('alertdialog')).textContent).toContain('The run “login-page” goes on working, and the ticket can be started or queued again.')
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }))
    await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['release', '2026-07-20_do-the-thing.md', '--force']))
    await waitFor(() => expect(screen.queryByText(/Claimed/)).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Do the thing' })))
  })

  test('editing a ticket a run is working on says the run may not see the change; one held for nobody says nothing', async () => {
    agents = [{ id: 'run-1', name: 'login-page', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'run-1' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findAllByText(/at work/)
    await openMenu(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByText('Edit ticket'))
    expect(screen.getByText('The run “login-page” is working on this ticket and started from it as it was: it may not see this change.')).toBeTruthy()
    cleanup()
    agents = [{ id: 'run-1', name: 'login-page', status: 'done', startedAt: '2026-08-30T10:00:00.000Z' }]
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await openMenu(await screen.findByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByText('Edit ticket'))
    expect(screen.queryByText(/may not see this change/)).toBeNull()
  })

  test('a failed release surfaces and keeps the claim visible (#1420)', async () => {
    onTicket.mockResolvedValue(ticket({ locked: true }))
    sendReleaseTicketLock.mockResolvedValue({ ok: false, error: 'the release could not be committed' })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await releaseFromMenu()
    expect(await screen.findByText(/could not be committed/i)).toBeTruthy()
    expect(screen.getByText(/Claimed/)).toBeTruthy()
  })

  test('Back returns to the list, the module\'s own page', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: /tickets/i }))
    expect(host.backToPage).toHaveBeenCalledWith('tickets')
  })

  test('a claim naming one of the project\'s runs reads as its session name and opens the run (#1748)', async () => {
    agents = [{ id: '2026-08-30T10-00-00-000Z', name: 'login-page', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: '2026-08-30T10-00-00-000Z' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: 'login-page' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', '2026-08-30T10-00-00-000Z')
  })

  test('a claim reads as its run\'s short name once the run has one, as the sidebar names it', async () => {
    agents = [{ id: 'run-1', name: 'login-page', title: 'Fix the login page', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'run-1' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByRole('button', { name: 'Fix the login page' })).toBeTruthy()
  })

  test('the sessions behind the ticket are one press away: the one that planned it, and the one holding its claim', async () => {
    agents = [
      { id: 'plan-run', ask: 'Create tickets/2026-07-20_do-the-thing.plan.md', title: 'Plan the thing', status: 'done', startedAt: '2026-08-29T10:00:00.000Z' },
      { id: 'run-1', name: 'login-page', title: 'Do the thing', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' },
    ]
    onTicket.mockResolvedValue(ticket({ planned: true, locked: true, lockedBy: 'run-1' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByText('Plan the thing')).toBeTruthy()
    expect(screen.getByText(/Being worked in/)).toBeTruthy()
    const [plan, work] = screen.getAllByRole('button', { name: 'Open session' })
    fireEvent.click(plan!)
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'plan-run')
    fireEvent.click(work!)
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-1')
    // The claim can still be lifted, from More.
    await openMenu(screen.getByRole('button', { name: 'More' }))
    expect(await screen.findByText('Release the claim')).toBeTruthy()
    cleanup()

    // Its claim released once the work was done, the work's session is still found by what it was asked.
    agents = [{ id: 'run-2', ask: 'Work on tickets/2026-07-20_do-the-thing.md. Do not start any other ticket.', title: 'Do the thing', status: 'done', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByText(/Worked in/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-2')
  })

  test('a session with no title yet is named as the claim on the line above names it, never by its id', async () => {
    agents = [{ id: '2026-11-13T20-09-35-236Z', name: 'login-page', ask: 'hold: move the cart to a page of its own', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: '2026-11-13T20-09-35-236Z' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    const session = (await screen.findByText(/Being worked in/)).closest('li')!
    expect(session.textContent).not.toContain('2026-11-13T20-09-35-236Z')
    const claim = screen.getByRole('button', { name: /hold/ })
    expect(session.textContent).toContain(`Being worked in ${claim.textContent}`)
  })

  test('a planning session that ended with no plan written is said to have been asked for one, not to have written it', async () => {
    agents = [{ id: 'plan-run', ask: 'Create tickets/2026-07-20_do-the-thing.plan.md', title: 'Plan the thing', status: 'done', startedAt: '2026-08-29T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ planned: false }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    const said = await screen.findByText('Asked for in')
    expect(said.parentElement!.textContent).toBe('Asked for in Plan the thing')
    expect(screen.queryByText(/Written in/)).toBeNull()
  })

  test('a command that cannot run is named, not shown as a missing ticket', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p2" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/no answer for p2/)).toBeTruthy()
    expect(screen.queryByText(/does not exist/i)).toBeNull()
  })
})

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
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

/** Queue the ticket's next step: its press beside the start. */
const queue = async (press: string) => fireEvent.click(await screen.findByRole('button', { name: press }))
/** The facts at the page's side. */
const facts = async () => within(await screen.findByRole('complementary', { name: 'About this ticket' }))
/** The value a fact of the side list says, by its name. */
const fact = async (name: string) => (await facts()).getByText(name, { selector: 'dt' }).nextElementSibling as HTMLElement
/** Lift the claim: its press. */
const release = async () => fireEvent.click(await screen.findByRole('button', { name: 'Release the claim' }))

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
    // The heading says the title; the breadcrumb's last step names the file, without its date.
    expect(screen.getAllByText('Do the thing')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('Ticketsdo-the-thing')
    expect(screen.getAllByText('The thing is not done.')).toHaveLength(1)
    expect(screen.queryByText('Priority: 8', { selector: 'p' })).toBeNull()
    // The fact named, its value the priority's key.
    expect((await fact('Priority')).textContent).toBe('P8')
    expect(screen.getByRole('tab', { name: 'Plan' })).toBeTruthy()
    expect(host.runCommand).toHaveBeenCalledWith('p1', ['show', '2026-07-20_do-the-thing.md', '--local'])
  })

  test('says at its side where it stands, its issue, when it was opened and its file (#1144/#1265)', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
    // Named with no day, it is dated by its file: two days ago.
    onTicket.mockResolvedValue(ticket({ file: 'do-the-thing.md', priority: '3', date: twoDaysAgo, issue: { label: '#42', url: 'https://example.com/org/repo/issues/42' } }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect((await fact('Stage')).textContent).toBe('Unplanned')
    expect((await fact('Issue')).querySelector('a')?.getAttribute('href')).toBe('https://example.com/org/repo/issues/42')
    expect((await fact('Opened')).textContent).toBe('2d ago')
    expect((await fact('File')).textContent).toBe('tickets/do-the-thing.md')
    // Where the facts are not beside the title, what decides the next step stands under it.
    expect(screen.getByRole('heading', { name: 'Do the thing' }).nextElementSibling?.textContent).toBe('P3·Unplanned')
  })

  test('a ticket in review or waiting is never offered to the queue, and says which', async () => {
    onTicket.mockResolvedValue(ticket({ pr: { label: '#12', url: 'https://example.com/pull/12' } }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect((await fact('Stage')).textContent).toBe('In review')
    expect((await fact('In review')).querySelector('a')?.getAttribute('href')).toBe('https://example.com/pull/12')
    expect(screen.queryByRole('button', { name: /^Queue / })).toBeNull()
    cleanup()
    onTicket.mockResolvedValue(ticket({ waiting: 'the vendor answer' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect((await fact('Waiting on')).textContent).toBe('the vendor answer')
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
    expect((await fact('Effort')).textContent).toBe('2/10')
    expect((await fact('Uncertainty')).textContent).toBe('0/10')
  })

  test('a planned ticket is handed as a link to the module\'s action, at the priority its own says (#1164/#1774)', async () => {
    onTicket.mockResolvedValue(ticket({ planned: true, priority: '8' }))
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await queue('Queue work')
    // The title as the link, pointing back at the ticket's file, its priority as a number on the
    // queue's own 0–10 scale.
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'Do the thing', href: 'tickets/2026-07-20_do-the-thing.md', priority: 8 }]))
  })

  test('a ticket with no priority is handed over at 5, the middle of the scale', async () => {
    onTicket.mockResolvedValue(ticket({ planned: true }))
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await queue('Queue work')
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'Do the thing', href: 'tickets/2026-07-20_do-the-thing.md', priority: 5 }]))
  })

  test('a ticket with no plan queues the ask for its plan, not the work', async () => {
    onTicket.mockResolvedValue(ticket({ priority: '8' }))
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByRole('button', { name: 'Plan now' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull()
    await queue('Queue plan')
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'Create tickets/2026-07-20_do-the-thing.plan.md', priority: 8 }]))
  })

  test('a queued ticket says so and cannot be queued twice', async () => {
    onTicket.mockResolvedValue(ticket())
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await queue('Queue plan')
    // The press now says so, and cannot be pressed again.
    const queued = await screen.findByRole('button', { name: 'Queued' })
    expect(queued.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(queued)
    expect(addToQueue).toHaveBeenCalledTimes(1)
  })

  test('a ticket already on the queue opens as Queued, its menu item off: the module reads it so', async () => {
    onTicket.mockResolvedValue(ticket())
    const onQueue = { ...modules().linkActions[0]!, done: async () => (link: { text: string }) => link.text === 'Create tickets/2026-07-20_do-the-thing.plan.md' }
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />, { ...modules(), linkActions: [onQueue] })
    expect((await screen.findByRole('button', { name: 'Queued' })).getAttribute('aria-disabled')).toBe('true')
    expect(addToQueue).not.toHaveBeenCalled()
  })

  test('a failed action surfaces its reason and leaves the button addable', async () => {
    onTicket.mockResolvedValue(ticket())
    addToQueue.mockResolvedValue({ ok: false, error: 'the queue could not be written' })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await queue('Queue plan')
    expect(await screen.findByText(/could not be written/i)).toBeTruthy()
    expect(screen.queryByText('Queued')).toBeNull()
    expect(screen.getByRole('button', { name: 'Queue plan' }).getAttribute('aria-disabled')).toBeNull()
  })

  test('no module offering an action on links in this project, no button (#1774)', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />, modules(['p2']))
    await screen.findByRole('heading', { name: 'Do the thing' })
    await openMenu(screen.getByRole('button', { name: 'Other ways to plan Do the thing' }))
    expect(await screen.findByText('Configure first, then run')).toBeTruthy()
    expect(screen.queryByText('Queue plan')).toBeNull()
  })

  test('a missing ticket says so rather than rendering blank', async () => {
    onTicket.mockResolvedValue(null)
    render(<TicketDetailPage projectId="p1" slug="gone.md" />)
    expect(await screen.findByText(/does not exist/i)).toBeTruthy()
  })

  test('a claimed ticket says so, names its holder, and offers its release (#1420)', async () => {
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'plan-1-0' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect((await fact('Stage')).textContent).toBe('Claimed')
    // The holder named, so a person knows whose claim they are about to lift.
    expect((await fact('Claimed by')).textContent).toBe('plan-1-0')
    expect(screen.getByRole('button', { name: 'Release the claim' })).toBeTruthy()
    // Not queued while claimed: the agent the queue hands it to would find it taken.
    expect(screen.queryByRole('button', { name: /^Queue / })).toBeNull()
  })

  test('an unclaimed ticket offers no release (#1420)', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findByRole('heading', { name: 'Do the thing' })
    expect(screen.queryAllByText(/Claimed/)).toHaveLength(0)
  })

  test('releasing runs `release --force` as an act and withdraws the claim without waiting for the next poll (#1420)', async () => {
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'plan-1-0' }))
    sendReleaseTicketLock.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await release()
    // An act, not a read: the dashboard syncs the branch and reads the lifted lock back at once.
    await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['release', '2026-07-20_do-the-thing.md', '--force']))
    expect(host.runCommand).not.toHaveBeenCalledWith('p1', expect.arrayContaining(['release']))
    await waitFor(() => expect(screen.queryAllByText(/Claimed/)).toHaveLength(0))
    // Released, it is a ticket like any other: it may be queued.
    expect(screen.getByRole('button', { name: 'Plan now' })).toBeTruthy()
  })

  test('releasing a claim whose run is at work asks first; released, the focus is on the ticket\'s title', async () => {
    agents = [{ id: 'run-1', name: 'login-page', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'run-1' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findAllByRole('button', { name: 'login-page' })
    await release()
    expect(host.act).not.toHaveBeenCalled()
    // The run is named as a run, not as the sentence's first word.
    expect((await screen.findByRole('alertdialog')).textContent).toContain('The run “login-page” goes on working, and the ticket can be started or queued again.')
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }))
    await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['release', '2026-07-20_do-the-thing.md', '--force']))
    await waitFor(() => expect(screen.queryAllByText(/Claimed/)).toHaveLength(0))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Do the thing' })))
  })

  test('editing a ticket a run is working on says the run may not see the change; one held for nobody says nothing', async () => {
    agents = [{ id: 'run-1', name: 'login-page', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'run-1' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findAllByRole('button', { name: 'login-page' })
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
    await release()
    expect(await screen.findByText(/could not be committed/i)).toBeTruthy()
    expect((await fact('Stage')).textContent).toBe('Claimed')
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
    await screen.findAllByRole('button', { name: 'login-page' })
    fireEvent.click(within(await fact('Claimed by')).getByRole('button', { name: 'login-page' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', '2026-08-30T10-00-00-000Z')
  })

  test('a claim reads as its run\'s short name once the run has one, as the sidebar names it', async () => {
    agents = [{ id: 'run-1', name: 'login-page', title: 'Fix the login page', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'run-1' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findAllByRole('button', { name: 'Fix the login page' })
    expect(within(await fact('Claimed by')).getByRole('button', { name: 'Fix the login page' })).toBeTruthy()
  })

  test('the runs behind the ticket are one press away: the one that planned it, and the one holding its claim', async () => {
    agents = [
      { id: 'plan-run', ask: 'Create tickets/2026-07-20_do-the-thing.plan.md', title: 'Plan the thing', status: 'done', startedAt: '2026-08-29T10:00:00.000Z' },
      { id: 'run-1', name: 'login-page', title: 'Work the thing', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' },
    ]
    onTicket.mockResolvedValue(ticket({ planned: true, locked: true, lockedBy: 'run-1' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    const runs = within((await screen.findByText('Runs on this ticket')).parentElement!)
    expect(runs.getByText('Plan the thing').getAttribute('title')).toMatch(/^Wrote its plan/)
    expect(runs.getByText('Work the thing').getAttribute('title')).toMatch(/^Working on it/)
    fireEvent.click(runs.getByRole('button', { name: 'Plan the thing' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'plan-run')
    fireEvent.click(runs.getByRole('button', { name: 'Work the thing' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-1')
    // The claim can still be lifted.
    expect(screen.getByRole('button', { name: 'Release the claim' })).toBeTruthy()
    cleanup()

    // Its claim released once the work was done, the work's run is still found by what it was asked.
    agents = [{ id: 'run-2', ask: 'Work on tickets/2026-07-20_do-the-thing.md. Do not start any other ticket.', title: 'Work the thing', status: 'done', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    const after = within((await screen.findByText('Runs on this ticket')).parentElement!)
    expect(after.getByText('Work the thing').getAttribute('title')).toMatch(/^Worked on it/)
    fireEvent.click(after.getByRole('button', { name: 'Work the thing' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-2')
  })

  test('a session with no title yet is named as the claim on the line above names it, never by its id', async () => {
    agents = [{ id: '2026-11-13T20-09-35-236Z', name: 'login-page', ask: 'hold: move the cart to a page of its own', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: '2026-11-13T20-09-35-236Z' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    // The look sets the claim and the runs at the side, the claim above the runs.
    const runs = (await screen.findByText('Runs on this ticket')).parentElement!
    expect(runs.textContent).not.toContain('2026-11-13T20-09-35-236Z')
    const claim = within(await fact('Claimed by')).getByRole('button')
    expect(within(runs).getByRole('button', { name: claim.textContent! })).toBeTruthy()
  })

  test('a planning session that ended with no plan written is said to have been asked for one, not to have written it', async () => {
    agents = [{ id: 'plan-run', ask: 'Create tickets/2026-07-20_do-the-thing.plan.md', title: 'Plan the thing', status: 'done', startedAt: '2026-08-29T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ planned: false }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    const runs = within((await screen.findByText('Runs on this ticket')).parentElement!)
    expect(runs.getByText('Plan the thing').getAttribute('title')).toMatch(/^Asked for its plan/)
    expect(runs.queryByTitle(/^Wrote its plan/)).toBeNull()
  })

  test('a command that cannot run is named, not shown as a missing ticket', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p2" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/no answer for p2/)).toBeTruthy()
    expect(screen.queryByText(/does not exist/i)).toBeNull()
  })
})

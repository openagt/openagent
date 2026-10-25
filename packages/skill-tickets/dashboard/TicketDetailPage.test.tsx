import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { ModuleAgent } from '@openagt/dashboard/module'
import type { MountedModules } from '../../openagent/dashboard/lib/use-modules.js'
import { fakeHost, renderWithHost, type FakeHost } from './test-host.js'
import { TicketDetailPage } from './TicketDetailPage.js'

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
  host = fakeHost({ p1: { [`show ${slug} --local`]: shown ? { ok: true, ticket: shown } : { ok: false, reason: 'no-ticket', file: slug } } }, { p1: agents })
  host.act.mockImplementation(async (_projectId, args) => {
    expect(args).toEqual(['release', slug, '--force'])
    return released.ok ? { ok: true, output: { ok: true, file: `tickets/${slug}` } } : released
  })
  return renderWithHost(ui, host, mounted)
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
  shown = null
  agents = []
  released = { ok: true }
  addToQueue.mockReset()
})

// One ticket's own page (#1144): the entire file, read by the same slug the list row and the
// route carry, plus the actions on it the one-liner list no longer has room for.
describe('TicketDetailPage (#1144)', () => {
  test('reads the ticket by slug and renders its full content', async () => {
    onTicket.mockResolvedValue(ticket({ priority: '8', planned: true }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    // The title heads the page, and the markdown body repeats it as its own `# ` heading — two
    // matches for the bare text, so assert the page's own heading specifically.
    expect(await screen.findByRole('heading', { name: 'Do the thing' })).toBeTruthy()
    expect(screen.getByText('More detail below the fold.')).toBeTruthy()
    // A bare "8" would be cryptic on its own (#1265); the badge spells out what it rates.
    expect(screen.getByText('Priority: 8')).toBeTruthy()
    expect(screen.getByText('planned')).toBeTruthy()
    expect(host.runCommand).toHaveBeenCalledWith('p1', ['show', '2026-07-20_do-the-thing.md', '--local'])
  })

  test('shows the issue link, date, and priority in that order below the description (#1144/#1265)', async () => {
    onTicket.mockResolvedValue(
      ticket({ priority: '3', issue: { label: '#42', url: 'https://example.com/org/repo/issues/42' }, summary: 'A short description.' }),
    )
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    const description = await screen.findByText('A short description.')
    const meta = description.nextElementSibling as HTMLElement
    const order = [meta.textContent?.indexOf('ago'), meta.textContent?.indexOf('Priority'), meta.textContent?.indexOf('#42')]
    expect(order.every(i => i !== undefined && i !== -1)).toBe(true)
    expect(order[0]).toBeLessThan(order[1] as number)
    expect(order[1]).toBeLessThan(order[2] as number)
    const link = screen.getByRole('link', { name: /#42/ })
    expect(link.getAttribute('href')).toBe('https://example.com/org/repo/issues/42')
  })

  test('shows the date in the meta below the description (#1144/#1265)', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
    onTicket.mockResolvedValue(ticket({ date: twoDaysAgo, summary: 'A short description.' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    const description = await screen.findByText('A short description.')
    // All meta, date included, moved below the description (#1265) — no longer beside it.
    const meta = description.nextElementSibling as HTMLElement
    expect(meta.textContent?.startsWith('2d ago')).toBe(true)
  })

  test('a ticket in review or waiting is never offered to the queue, and says which', async () => {
    onTicket.mockResolvedValue(ticket({ pr: { label: '#12', url: 'https://example.com/pull/12' } }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByText('in review')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to queue' })).toBeNull()
    cleanup()
    onTicket.mockResolvedValue(ticket({ waiting: 'the vendor answer' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByText(/the vendor answer/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to queue' })).toBeNull()
  })

  test('shows the effort and uncertainty the plan recorded, with the rest of the meta (#1144/#1265)', async () => {
    onTicket.mockResolvedValue(ticket({ planned: true, effort: 2, uncertainty: 0 }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByText('Effort: 2')).toBeTruthy()
    expect(screen.getByText('Uncertainty: 0')).toBeTruthy()
  })

  test('the ticket is handed as a link to the module\'s action, at the priority its own says (#1164/#1774)', async () => {
    onTicket.mockResolvedValue(ticket({ priority: '8' }))
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue' }))
    // The title as the link, pointing back at the ticket's file, its priority as a number on the
    // queue's own 0–10 scale.
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'Do the thing', href: 'tickets/2026-07-20_do-the-thing.md', priority: 8 }]))
  })

  test('a ticket with no priority is handed over at 5, the middle of the scale', async () => {
    onTicket.mockResolvedValue(ticket())
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue' }))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'Do the thing', href: 'tickets/2026-07-20_do-the-thing.md', priority: 5 }]))
  })

  test('a queued ticket says so and cannot be queued twice', async () => {
    onTicket.mockResolvedValue(ticket())
    addToQueue.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue' }))
    const queued = await screen.findByRole('button', { name: 'Queued' })
    expect((queued as HTMLButtonElement).disabled).toBe(true)
  })

  test('a failed action surfaces its reason and leaves the button addable', async () => {
    onTicket.mockResolvedValue(ticket())
    addToQueue.mockResolvedValue({ ok: false, error: 'the queue could not be written' })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue' }))
    expect(await screen.findByText(/could not be written/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Queued' })).toBeNull()
  })

  test('no module offering an action on links in this project, no button (#1774)', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />, modules(['p2']))
    await screen.findByRole('heading', { name: 'Do the thing' })
    expect(screen.queryByRole('button', { name: /queue/i })).toBeNull()
  })

  test('a missing ticket says so rather than rendering blank', async () => {
    onTicket.mockResolvedValue(null)
    render(<TicketDetailPage projectId="p1" slug="gone.md" />)
    expect(await screen.findByText(/does not exist/i)).toBeTruthy()
  })

  test('a claimed ticket shows its badge, holder, and a release button (#1420)', async () => {
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'plan-1-0' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findByText('claimed')
    // The holder reads inline so a human knows whose claim they are about to lift — the detail
    // page has the room, no tooltip hunt needed.
    expect(screen.getByText(/· plan-1-0/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /release lock/i })).toBeTruthy()
    // Not queued while claimed: the agent the queue hands it to would find it taken.
    expect(screen.queryByRole('button', { name: 'Add to queue' })).toBeNull()
  })

  test('an unclaimed ticket offers no release (#1420)', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    await screen.findByRole('heading', { name: 'Do the thing' })
    expect(screen.queryByText('claimed')).toBeNull()
    expect(screen.queryByRole('button', { name: /release lock/i })).toBeNull()
  })

  test('releasing runs `release --force` as an act and withdraws the claim without waiting for the next poll (#1420)', async () => {
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'plan-1-0' }))
    sendReleaseTicketLock.mockResolvedValue({ ok: true })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: /release lock/i }))
    // An act, not a read: the dashboard syncs the branch and reads the lifted lock back at once.
    await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['release', '2026-07-20_do-the-thing.md', '--force']))
    expect(host.runCommand).not.toHaveBeenCalledWith('p1', expect.arrayContaining(['release']))
    await waitFor(() => expect(screen.queryByText('claimed')).toBeNull())
    expect(screen.queryByRole('button', { name: /release lock/i })).toBeNull()
    // Released, it is a ticket like any other: it may be queued.
    expect(screen.getByRole('button', { name: 'Add to queue' })).toBeTruthy()
  })

  test('a failed release surfaces and keeps the claim visible (#1420)', async () => {
    onTicket.mockResolvedValue(ticket({ locked: true }))
    sendReleaseTicketLock.mockResolvedValue({ ok: false, error: 'the release could not be committed' })
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: /release lock/i }))
    expect(await screen.findByText(/could not be committed/i)).toBeTruthy()
    expect(screen.getByText('claimed')).toBeTruthy()
  })

  test('Back returns to the list, the module\'s own page', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: /tickets/i }))
    expect(host.openPage).toHaveBeenCalledWith('tickets')
  })

  test('a claim naming one of the project\'s runs reads as its session name and opens the run (#1748)', async () => {
    agents = [{ id: '2026-08-30T10-00-00-000Z', name: 'login-page', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: '2026-08-30T10-00-00-000Z' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: 'login-page' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', '2026-08-30T10-00-00-000Z')
  })

  test('the run holding the claim is one press away at the top: looked at while it works, gone on with once it stopped', async () => {
    agents = [{ id: 'run-1', name: 'login-page', status: 'running', startedAt: '2026-08-30T10:00:00.000Z' }]
    onTicket.mockResolvedValue(ticket({ locked: true, lockedBy: 'run-1' }))
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open the run' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-1')
    expect(screen.getByText(/at work/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    cleanup()

    agents = [{ id: 'run-1', name: 'login-page', status: 'stopped', startedAt: '2026-08-30T10:00:00.000Z' }]
    render(<TicketDetailPage projectId="p1" slug="2026-07-20_do-the-thing.md" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-1')
    expect(screen.getByText(/run stopped/)).toBeTruthy()
    // The claim can still be lifted beside it.
    expect(screen.getByRole('button', { name: /release lock/i })).toBeTruthy()
  })

  test('a command that cannot run is named, not shown as a missing ticket', async () => {
    onTicket.mockResolvedValue(ticket())
    render(<TicketDetailPage projectId="p2" slug="2026-07-20_do-the-thing.md" />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/no answer for p2/)).toBeTruthy()
    expect(screen.queryByText(/does not exist/i)).toBeNull()
  })
})

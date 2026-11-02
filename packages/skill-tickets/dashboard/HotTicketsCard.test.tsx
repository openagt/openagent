import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { LinkAction } from '@openagt/dashboard/module'
import type { MountedModules } from '../../dashboard/dashboard/lib/use-modules.js'
import { HotTicketsCard } from './HotTicketsCard.js'
import { fakeHost, renderWithHost, NO_MODULES, type Answers, type FakeHost } from './test-host.js'

// The card on the Overview, rendered from nothing but this package: a host answering the tickets
// command and the project's runs, and, unless a test mounts one, no other module. Whether a row
// leads to a queue is the installed modules' business, not the card's.

const alpha = { id: 'p1', name: 'alpha', gitHost: true }
const beta = { id: 'p2', name: 'beta', gitHost: true }

const ticket = (file: string, over: Record<string, unknown> = {}) => ({ file, title: file.replace(/\.md$/, ''), summary: '', date: '2026-08-01T00:00:00.000Z', planned: false, ...over })

let host: FakeHost
const render = (answers: Answers, agents: Parameters<typeof fakeHost>[1] = {}, modules: MountedModules = NO_MODULES) => {
  host = fakeHost(answers, agents)
  return renderWithHost(<HotTicketsCard projects={[alpha, beta]} />, host, modules)
}

afterEach(cleanup)

describe('HotTicketsCard', () => {
  test('pools every project: a claimed ticket, an unclaimed one at 7+ by its priority, the rest off the card', async () => {
    render({
      p1: { 'list --local': [ticket('held.md', { locked: true, lockedBy: 'someone', priority: '2' }), ticket('urgent.md', { priority: '9' }), ticket('later.md', { priority: '3' })] },
      p2: { 'list --local': [ticket('also-urgent.md', { priority: '7' })] },
    })
    expect(await screen.findByText('held')).toBeTruthy()
    expect(screen.getByText('urgent')).toBeTruthy()
    expect(screen.getByText('also-urgent')).toBeTruthy()
    expect(screen.queryByText('later')).toBeNull()
    // Held by no run of the project's: held for nobody, and who claimed it said on its mark.
    expect(screen.getByLabelText('No run holds it any more, claimed by someone')).toBeTruthy()
    expect(screen.getByLabelText('Priority 9')).toBeTruthy()
    // The project said at each row's end, beside its fact when it has one.
    expect(screen.getAllByText(/alpha/)).toHaveLength(2)
    expect(screen.getByText(/beta/)).toBeTruthy()
    expect(host.runCommand).toHaveBeenCalledWith('p1', ['list', '--local'])
    // Only the runs holding a claim are asked for; a project with none claimed asks for no run.
    expect(host.agents).toHaveBeenCalledWith('p1', { ids: ['someone'] })
    expect(host.agents).toHaveBeenCalledTimes(1)
  })

  test('a high-priority ticket in review stays off the card; a waiting one, of any priority, is in Waiting with what it waits on', async () => {
    render({
      p1: {
        'list --local': [
          ticket('urgent.md', { priority: '9' }),
          ticket('reviewed.md', { priority: '9', pr: { label: '#12', url: 'u' } }),
          ticket('blocked.md', { priority: '9', waiting: 'the vendor' }),
          ticket('low-blocked.md', { priority: '2', waiting: 'the design review' }),
        ],
      },
      p2: { 'list --local': [] },
    })
    expect(await screen.findByText('urgent')).toBeTruthy()
    expect(screen.queryByText('reviewed')).toBeNull()
    expect(screen.getByLabelText('Waiting on the vendor')).toBeTruthy()
    expect(screen.getByText('blocked')).toBeTruthy()
    expect(screen.getByText('low-blocked')).toBeTruthy()
    expect(screen.getByText(/the vendor/)).toBeTruthy()
    expect(screen.getByText(/the design review/)).toBeTruthy()
    // The heading's count: the two waiting tickets.
    expect(within(screen.getByRole('region', { name: 'Waiting' })).getAllByRole('listitem')).toHaveLength(2)
  })

  test('a row opens the ticket\'s page; a claim held by one of the project\'s runs opens that run', async () => {
    render(
      { p1: { 'list --local': [ticket('held.md', { locked: true, lockedBy: 'run-1' })] }, p2: { 'list --local': [] } },
      { p1: [{ id: 'run-1', name: 'login-page', status: 'running', startedAt: '2026-08-01T00:00:00.000Z' }] },
    )
    fireEvent.click(await screen.findByText('held'))
    expect(host.openPage).toHaveBeenCalledWith('tickets', ['held.md'], 'p1')
    // The run at work opens from the mark that says so.
    fireEvent.click(screen.getByRole('button', { name: 'Its run is at work, claimed by login-page: open the run' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-1')
  })

  test('a claim is told apart by its run: one at work, or waiting on an answer, is being worked on; one whose run stopped holds the ticket for nobody', async () => {
    render(
      {
        p1: {
          'list --local': [
            ticket('busy.md', { locked: true, lockedBy: 'run-1' }),
            ticket('asking.md', { locked: true, lockedBy: 'run-2' }),
            ticket('left.md', { locked: true, lockedBy: 'run-3' }),
          ],
        },
        p2: { 'list --local': [] },
      },
      {
        p1: [
          { id: 'run-1', status: 'running', startedAt: '2026-08-01T00:00:00.000Z' },
          { id: 'run-2', status: 'waiting', startedAt: '2026-08-01T00:00:00.000Z' },
          { id: 'run-3', status: 'stopped', startedAt: '2026-08-01T00:00:00.000Z' },
        ],
      },
    )
    await screen.findByText('busy')
    const working = screen.getByRole('region', { name: 'Being worked on' }).textContent
    expect(working).toContain('busy')
    expect(working).toContain('asking')
    expect(screen.getByRole('region', { name: 'Claimed, run stopped' }).textContent).toContain('left')
    expect(screen.getByLabelText('Its run waits on your answer, claimed by run-2: open the run')).toBeTruthy()
    // The claims held for nobody come first: they are the ones a person has to act on.
    expect(screen.getAllByRole('region')[0]!.getAttribute('aria-label')).toBe('Claimed, run stopped')
  })

  test("a claim whose run's computer is offline is neither being worked on nor stopped: it says which computer and since when", async () => {
    const seenAt = '2026-10-25T10:42:00.000Z'
    render(
      { p1: { 'list --local': [ticket('far.md', { locked: true, lockedBy: 'run-1' })] }, p2: { 'list --local': [] } },
      { p1: [{ id: 'run-1', status: 'unknown', startedAt: '2026-10-25T10:00:00.000Z', machine: 'MacBook', seenAt }] },
    )
    await screen.findByText('far')
    expect(screen.getByRole('region', { name: 'Claimed, computer offline' }).textContent).toContain('far')
    expect(screen.queryByRole('region', { name: 'Being worked on' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Claimed, run stopped' })).toBeNull()
    expect(screen.getByLabelText(`MacBook is offline, last seen ${new Date(seenAt).toLocaleString()}: how its run stands is unknown, claimed by run-1`)).toBeTruthy()
  })

  test('a claim whose run stopped is gone on with in its run, or let go: the claim is lifted, whoever holds it, and the card reads again; it offers no link action meanwhile', async () => {
    const run = vi.fn<LinkAction['run']>(async () => ({ ok: true as const }))
    render(
      { p1: { 'list --local': [ticket('left.md', { locked: true, lockedBy: 'run-3' })], 'release left.md --force': { ok: true } }, p2: { 'list --local': [] } },
      { p1: [{ id: 'run-3', status: 'stopped', startedAt: '2026-08-01T00:00:00.000Z' }] },
      { ...NO_MODULES, linkActions: [{ label: 'Add to queue', doneLabel: 'Queued', run, package: '@x/queue', projects: ['p1'] }] },
    )
    await screen.findByText('left')
    expect(screen.queryByRole('button', { name: 'Add to queue' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-3')
    const reads = host.runCommand.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['release', 'left.md', '--force']))
    await waitFor(() => expect(host.runCommand.mock.calls.length).toBeGreaterThan(reads))
  })

  test('a claimed ticket in review stays in Claimed but offers no link action', async () => {
    const run = vi.fn<LinkAction['run']>(async () => ({ ok: true as const }))
    render(
      { p1: { 'list --local': [ticket('held.md', { locked: true, lockedBy: 'someone', pr: { label: '#12', url: 'u' } }), ticket('urgent.md', { priority: '8' })] }, p2: { 'list --local': [] } },
      {},
      { ...NO_MODULES, linkActions: [{ label: 'Add to queue', doneLabel: 'Queued', run, package: '@x/queue', projects: ['p1'] }] },
    )
    expect(await screen.findByText('held')).toBeTruthy()
    // Only the ready ticket's row offers the action.
    expect(screen.getAllByRole('button', { name: 'Add to queue' })).toHaveLength(1)
  })

  test('with no other module installed the rows offer nothing on the ticket; with a link action mounted, each row offers it on the ticket as a link', async () => {
    const answers: Answers = { p1: { 'list --local': [ticket('urgent.md', { priority: '8' })] }, p2: { 'list --local': [] } }
    render(answers)
    await screen.findByText('urgent')
    expect(screen.queryByRole('button', { name: /Add to queue/ })).toBeNull()
    cleanup()

    const run = vi.fn<LinkAction['run']>(async () => ({ ok: true as const }))
    render(answers, {}, { ...NO_MODULES, linkActions: [{ label: 'Add to queue', doneLabel: 'Queued', run, package: '@x/queue', projects: ['p1'] }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Add to queue' }))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(run.mock.calls[0]![1]).toBe('p1')
    expect(run.mock.calls[0]![2]).toEqual([{ text: 'urgent', href: 'tickets/urgent.md', priority: 8 }])
    expect(await screen.findByRole('button', { name: 'Queued' })).toBeTruthy()
  })

  test('says what the empty state means, and names a project whose command failed while the others show', async () => {
    render({ p1: { 'list --local': [] }, p2: { 'list --local': [] } })
    expect(await screen.findByText('Nothing claimed, high priority or waiting.')).toBeTruthy()
    cleanup()
    render({ p1: { 'list --local': [ticket('urgent.md', { priority: '8' })] } })
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read the tickets of beta: no answer for p2: tickets list --local')
    expect(screen.getByText('urgent')).toBeTruthy()
  })

  test('a kind with nothing in it has no heading', async () => {
    render({ p1: { 'list --local': [ticket('urgent.md', { priority: '9' })] }, p2: { 'list --local': [] } })
    expect(await screen.findByText('urgent')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'High priority' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Waiting' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Claimed, run stopped' })).toBeNull()
  })

  test('the card\'s title opens the Tickets page', async () => {
    render({ p1: { 'list --local': [] }, p2: { 'list --local': [] } })
    // Read once the card has loaded: the loading card is drawn anew as the empty one.
    await screen.findByText('Nothing claimed, high priority or waiting.')
    const title = screen.getByRole('link', { name: 'Hot tickets' })
    expect(title.getAttribute('href')).toBe('/tickets')
    fireEvent.click(title)
    expect(host.openPage).toHaveBeenCalledWith('tickets')
  })
})

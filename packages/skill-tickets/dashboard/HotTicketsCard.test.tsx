import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { LinkAction } from '@openagt/dashboard/module'
import type { MountedModules } from '../../openagent/dashboard/lib/use-modules.js'
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
  test('pools every project: a claimed ticket in the Claimed lane, an unclaimed one at 7+ in High priority, the rest off the card', async () => {
    render({
      p1: { 'list --local': [ticket('held.md', { locked: true, lockedBy: 'someone', priority: '2' }), ticket('urgent.md', { priority: '9' }), ticket('later.md', { priority: '3' })] },
      p2: { 'list --local': [ticket('also-urgent.md', { priority: '7' })] },
    })
    expect(await screen.findByText('held')).toBeTruthy()
    expect(screen.getByText('urgent')).toBeTruthy()
    expect(screen.getByText('also-urgent')).toBeTruthy()
    expect(screen.queryByText('later')).toBeNull()
    expect(screen.getByText('someone')).toBeTruthy()
    expect(screen.getAllByText('alpha')).toHaveLength(2)
    expect(screen.getByText('beta')).toBeTruthy()
    expect(host.runCommand).toHaveBeenCalledWith('p1', ['list', '--local'])
    expect(host.agents).toHaveBeenCalledWith('p2')
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
    expect(screen.getByText('Waiting')).toBeTruthy()
    expect(screen.getByText('blocked')).toBeTruthy()
    expect(screen.getByText('low-blocked')).toBeTruthy()
    expect(screen.getByText('the vendor')).toBeTruthy()
    expect(screen.getByText('the design review')).toBeTruthy()
    // The lane's count: the two waiting tickets.
    expect(screen.getByText('Waiting').nextElementSibling?.textContent).toBe('2')
  })

  test('a row opens the ticket\'s page; a claim held by one of the project\'s runs opens that run', async () => {
    render(
      { p1: { 'list --local': [ticket('held.md', { locked: true, lockedBy: 'run-1' })] }, p2: { 'list --local': [] } },
      { p1: [{ id: 'run-1', name: 'login-page', status: 'running', startedAt: '2026-08-01T00:00:00.000Z' }] },
    )
    fireEvent.click(await screen.findByText('held'))
    expect(host.openPage).toHaveBeenCalledWith('tickets', ['p1', 'held.md'])
    fireEvent.click(screen.getByText('login-page'))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-1')
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

  test('a lane with nothing in it is not drawn: no "Claimed 0" beside the lanes that have tickets', async () => {
    render({ p1: { 'list --local': [ticket('urgent.md', { priority: '9' })] }, p2: { 'list --local': [] } })
    expect(await screen.findByText('urgent')).toBeTruthy()
    expect(screen.getByText('High priority')).toBeTruthy()
    expect(screen.queryByText('Claimed')).toBeNull()
    expect(screen.queryByText('Waiting')).toBeNull()
  })

  test('the card\'s title opens the Tickets page', async () => {
    render({ p1: { 'list --local': [] }, p2: { 'list --local': [] } })
    const title = await screen.findByRole('link', { name: 'Hot tickets' })
    expect(title.getAttribute('href')).toBe('/tickets')
    fireEvent.click(title)
    expect(host.openPage).toHaveBeenCalledWith('tickets')
  })
})

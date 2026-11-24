import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueuePart } from './QueuePart.js'
import { fakeHost as hostFor, mountedOf } from '@openagt/ui/module/testing'
import { fakeHost, placed, renderWithHost } from './test-host.js'

// The queue's part of the Overview's line: how many entries wait, over how many projects on a hover; it opens the Queue page.

afterEach(cleanup)

test('how many entries wait over the projects shown, and over how many on its hover; it opens the Queue page', async () => {
  const host = fakeHost({ p1: placed('a', 'b'), p2: placed('c') })
  renderWithHost(<QueuePart projects={[{ id: 'p1', name: 'alpha', remote: 'github.com/me/project' }, { id: 'p2', name: 'beta', remote: 'github.com/me/project' }]} />, host)
  const part = await screen.findByRole('link', { name: '3 queued' })
  expect(part.getAttribute('title')).toBe('Across 2 projects')
  expect(part.getAttribute('href')).toBe('/queue')
  fireEvent.click(part)
  expect(host.openPage).toHaveBeenCalledWith('queue')
})

test('an empty queue is said in words', async () => {
  renderWithHost(<QueuePart projects={[{ id: 'p3', name: 'gamma', remote: 'github.com/me/project' }]} />, fakeHost({ p3: [] }))
  expect(await screen.findByRole('link', { name: 'nothing queued' })).toBeTruthy()
})

test('an entry whose file is there already (a plan already written) waits for nothing, and is not counted', async () => {
  const host = fakeHost({ p3: placed('Create tickets/2026-08-01_login-page.plan.md', 'Tidy the loader') })
  const names = async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md', done: { ask: 'Create tickets/2026-08-01_login-page.plan.md', title: 'Plan: Login page · already written' } } })
  renderWithHost(<QueuePart projects={[{ id: 'p3', name: 'gamma', remote: 'github.com/me/project' }]} />, host, mountedOf({ views: { 'app.page': [{ place: 'app.page', id: 'tickets', label: 'Tickets', View: () => null, package: 'a-tickets', projects: ['p3'], names }] } }))
  const part = await screen.findByRole('link', { name: '1 queued' })
  expect(part.getAttribute('title')).toBe('Waits for an agent')
})

test('an entry that names a plan already written but asks something else of it waits for an agent, and is counted', async () => {
  const host = fakeHost({ p3: placed('Review tickets/2026-08-01_login-page.plan.md for accessibility issues') })
  const names = vi.fn(async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md', done: { ask: 'Create tickets/2026-08-01_login-page.plan.md', title: 'Plan: Login page · already written' } } }))
  renderWithHost(<QueuePart projects={[{ id: 'p3', name: 'gamma', remote: 'github.com/me/project' }]} />, host, mountedOf({ views: { 'app.page': [{ place: 'app.page', id: 'tickets', label: 'Tickets', View: () => null, package: 'a-tickets', projects: ['p3'], names }] } }))
  // Counted once the name is read too, not only before it.
  await waitFor(() => expect(names).toHaveBeenCalled())
  await act(() => new Promise(resolve => setTimeout(resolve, 50)))
  expect(screen.getByRole('link', { name: '1 queued' }).getAttribute('title')).toBe('Waits for an agent')
})

test('no count before the queue is read', () => {
  renderWithHost(<QueuePart projects={[{ id: 'p1', name: 'alpha', remote: 'github.com/me/project' }]} />, hostFor('@openagt/queue', { call: () => new Promise(() => {}) }))
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByText('Loading…')).toBeTruthy()
})

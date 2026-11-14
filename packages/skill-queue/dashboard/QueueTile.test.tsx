import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueueTile } from './QueueTile.js'
import { fakeHost as hostFor } from '@openagt/dashboard/module/testing'
import { NO_MODULES, fakeHost, renderWithHost } from './test-host.js'

// The Overview's tile for the queue: how many entries wait, over how many projects; it opens the Queue page.

afterEach(cleanup)

test('how many entries wait over the projects shown, and over how many; it opens the Queue page', async () => {
  const host = fakeHost({ p1: { '--local': ['a', 'b'] }, p2: { '--local': ['c'] } })
  renderWithHost(<QueueTile projects={[{ id: 'p1', name: 'alpha', gitHost: true }, { id: 'p2', name: 'beta', gitHost: true }]} />, host)
  expect(await screen.findByText('Across 2 projects')).toBeTruthy()
  const tile = screen.getByRole('link')
  expect(tile.textContent).toBe('In the queue3Across 2 projects')
  expect(tile.getAttribute('href')).toBe('/queue')
  fireEvent.click(tile)
  expect(host.openPage).toHaveBeenCalledWith('queue')
})

test('an entry whose file is there already (a plan already written) waits for nothing, and is not counted', async () => {
  const host = fakeHost({ p3: { '--local': ['Create tickets/2026-08-01_login-page.plan.md', 'Tidy the loader'] } })
  const names = async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md', done: { ask: 'Create tickets/2026-08-01_login-page.plan.md', title: 'Plan: Login page · already written' } } })
  renderWithHost(<QueueTile projects={[{ id: 'p3', name: 'gamma', gitHost: true }]} />, host, { ...NO_MODULES, pages: [{ segment: 'tickets', label: 'Tickets', Page: () => null, package: 'a-tickets', projects: ['p3'], names }] })
  await waitFor(() => expect(screen.getByRole('link').textContent).toBe('In the queue1Waits for an agent'))
})

test('an entry that names a plan already written but asks something else of it waits for an agent, and is counted', async () => {
  const host = fakeHost({ p3: { '--local': ['Review tickets/2026-08-01_login-page.plan.md for accessibility issues'] } })
  const names = vi.fn(async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md', done: { ask: 'Create tickets/2026-08-01_login-page.plan.md', title: 'Plan: Login page · already written' } } }))
  renderWithHost(<QueueTile projects={[{ id: 'p3', name: 'gamma', gitHost: true }]} />, host, { ...NO_MODULES, pages: [{ segment: 'tickets', label: 'Tickets', Page: () => null, package: 'a-tickets', projects: ['p3'], names }] })
  // Counted once the name is read too, not only before it.
  await waitFor(() => expect(names).toHaveBeenCalled())
  await act(() => new Promise(resolve => setTimeout(resolve, 50)))
  expect(screen.getByRole('link').textContent).toBe('In the queue1Waits for an agent')
})

test('no count before the queue is read', () => {
  renderWithHost(<QueueTile projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} />, hostFor('@openagt/skill-queue', { runCommand: () => new Promise(() => {}) }))
  expect(screen.getByRole('link').textContent).toBe('In the queue\u00a0Loading…')
})

import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { QueuePart } from './QueuePart.js'
import { fakeHost as hostFor } from '@openagt/dashboard/module/testing'
import { fakeHost, renderWithHost } from './test-host.js'

// The queue's part of the Overview's line: how many entries wait, over how many projects on a hover; it opens the Queue page.

afterEach(cleanup)

test('how many entries wait over the projects shown, and over how many on its hover; it opens the Queue page', async () => {
  const host = fakeHost({ p1: { '--local': ['a', 'b'] }, p2: { '--local': ['c'] } })
  renderWithHost(<QueuePart projects={[{ id: 'p1', name: 'alpha', gitHost: true }, { id: 'p2', name: 'beta', gitHost: true }]} />, host)
  const part = await screen.findByRole('link', { name: '3 queued' })
  expect(part.getAttribute('title')).toBe('Across 2 projects')
  expect(part.getAttribute('href')).toBe('/queue')
  fireEvent.click(part)
  expect(host.openPage).toHaveBeenCalledWith('queue')
})

test('an empty queue is said in words', async () => {
  renderWithHost(<QueuePart projects={[{ id: 'p3', name: 'gamma', gitHost: true }]} />, fakeHost({ p3: { '--local': [] } }))
  expect(await screen.findByRole('link', { name: 'nothing queued' })).toBeTruthy()
})

test('no count before the queue is read', () => {
  renderWithHost(<QueuePart projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} />, hostFor('@openagt/skill-queue', { runCommand: () => new Promise(() => {}) }))
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByText('Loading…')).toBeTruthy()
})

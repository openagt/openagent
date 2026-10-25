import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { QueueTile } from './QueueTile.js'
import { fakeHost, renderWithHost } from './test-host.js'

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

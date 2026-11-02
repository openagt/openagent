import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Page } from './Page.js'

// A page that is no chat: its header (name, count, line, buttons, a bar of its own) over what it
// shows, in the one column every such page has. On a wide screen the name shows; on a phone the
// phone's bar names the page, and the heading is said to a screen reader only.

afterEach(cleanup)

test('the name, its count, the line under it and the page\'s buttons in a header, and a bar under them, over what the page shows, in one centered column', () => {
  render(
    <Page title="Tickets" count="3/5" description="Every project's backlog" actions={<button type="button">Add to queue</button>} bar={<p>filters</p>}>
      <p>the list</p>
    </Page>,
  )
  const heading = screen.getByRole('heading', { level: 1 })
  expect(heading.textContent).toBe('Tickets3/5')
  // The name is hidden on a phone only, where its bar says it.
  expect(screen.getByText('Tickets').className).toContain('max-md:sr-only')
  const header = heading.closest('header')!
  expect(header.textContent).toContain("Every project's backlog")
  expect(header.textContent).toContain('Add to queue')
  expect(header.textContent).toContain('filters')
  // What the page shows comes after its header, in the same column.
  const column = header.parentElement!
  expect(column.className.split(' ')).toEqual(expect.arrayContaining(['mx-auto', 'max-w-6xl']))
  expect(column.lastElementChild!.textContent).toBe('the list')
  // Drawn alone, with no sidebar around it, it offers none to show.
  expect(screen.queryByRole('button', { name: 'Show the sidebar' })).toBeNull()
})

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
  expect(heading.textContent).toBe('Tickets 3/5')
  // The name is hidden on a phone only, where its bar says it.
  expect(screen.getByText('Tickets').className).toContain('max-md:sr-only')
  const header = heading.closest('header')!
  expect(header.textContent).toContain("Every project's backlog")
  expect(header.textContent).toContain('Add to queue')
  expect(header.textContent).toContain('filters')
  // What the page shows comes after its header, in the same column: 960 at most, on every page.
  const column = header.parentElement!
  expect(column.className.split(' ')).toEqual(expect.arrayContaining(['mx-auto', 'max-w-240']))
  expect(column.lastElementChild!.textContent).toBe('the list')
  // Drawn alone, with no sidebar around it, it offers none to show.
  expect(screen.queryByRole('button', { name: 'Show the sidebar' })).toBeNull()
})

test("the buttons stand in the name's row, at its right, and the line under that row: however long it is, it moves no button", () => {
  render(
    <Page title="Queue" count={3} description={'What agents will work on next. '.repeat(10)} actions={<button type="button">Start 3 agents</button>}>
      <p>the list</p>
    </Page>,
  )
  const heading = screen.getByRole('heading', { level: 1 })
  const buttons = screen.getByRole('button', { name: 'Start 3 agents' }).parentElement!
  const row = buttons.parentElement!
  expect(row.contains(heading)).toBe(true)
  expect(row.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'justify-between']))
  expect(row.className).not.toMatch(/flex-wrap/)
  expect(row.textContent).not.toContain('What agents will work on next.')
  // Said to a screen reader only on a phone, where the bar names the page.
  expect(screen.getByText(/What agents will work on next\./).className).toContain('max-md:sr-only')
  // The buttons give up width: they go under each other, from the right, when the row is narrower than them.
  expect(buttons.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'flex-wrap', 'justify-end']))
  expect(buttons.className).not.toMatch(/shrink-0/)
  // The name and its count never do: the count stays beside the name.
  expect(heading.parentElement!.className.split(' ')).toContain('shrink-0')
})

test('on a phone, a page with no count and no buttons draws no empty row under the bar', () => {
  render(
    <Page title="Logs" description="Every run">
      <p>the list</p>
    </Page>,
  )
  expect(screen.getByRole('heading', { level: 1 }).closest('header')!.firstElementChild!.className).toContain('max-md:sr-only')
})

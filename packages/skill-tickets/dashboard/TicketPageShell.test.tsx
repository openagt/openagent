import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SidebarHidden } from '@openagt/dashboard/module/testing'
import { TicketPageShell } from './TicketPageShell.js'

afterEach(cleanup)

describe("a ticket's page", () => {
  test('while the sidebar is hidden, "Show the sidebar" stands before the way back, and pressing it shows the sidebar', () => {
    render(
      <SidebarHidden>
        <TicketPageShell onBack={() => {}}>A ticket</TicketPageShell>
      </SidebarHidden>,
    )
    const show = screen.getByRole('button', { name: 'Show the sidebar' })
    expect(show.compareDocumentPosition(screen.getByRole('button', { name: 'Tickets' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).toBeNull()
    fireEvent.click(show)
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show the sidebar' })).toBeNull()
  })
})

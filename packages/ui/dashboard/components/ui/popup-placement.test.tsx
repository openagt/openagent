import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu.js'
import { PopupPlacementContext } from './popup-placement.js'

// A popup opened from a part that stays put while the page scrolls (the pinned sidebar) is placed
// against the window: placed against the page, it jumped with each scroll.

afterEach(cleanup)

function Menu() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Item</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The menu's positioner: the nearest element above the item placed by Base UI. */
const placement = async () => {
  let at: HTMLElement | null = await screen.findByRole('menuitem', { name: 'Item' })
  while (at && at.style.position !== 'fixed' && at.style.position !== 'absolute') at = at.parentElement
  return at?.style.position
}

describe('where a menu is placed', () => {
  test('opened from a part placed against the window: against the window', async () => {
    render(
      <PopupPlacementContext.Provider value="fixed">
        <Menu />
      </PopupPlacementContext.Provider>,
    )
    expect(await placement()).toBe('fixed')
  })

  test('anywhere else: against the page, scrolling along with it', async () => {
    render(<Menu />)
    expect(await placement()).toBe('absolute')
  })
})

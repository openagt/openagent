import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ScrollArea } from './scroll-area.js'

afterEach(cleanup)

// The bar is only drawn while the content overflows, and jsdom measures every box as 0: the
// viewport is given content taller than it is (and as wide), so the bar's tests have a bar to look at.
const sizes = { clientHeight: 100, scrollHeight: 500, clientWidth: 200, scrollWidth: 200 }
function overflow() {
  for (const [name, size] of Object.entries(sizes)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return this.matches('[data-slot="scroll-area-viewport"]') ? size : 0 } })
  }
}
function part(name: string): Element {
  const el = document.querySelector(`[data-slot="scroll-area-${name}"]`)
  if (!el) throw new Error(`no scroll-area-${name}`)
  return el
}
afterEach(() => {
  for (const name of Object.keys(sizes)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
})

// #913: the panels' scrolled content moved inside a component, so the thing worth pinning is that
// it is still one scrolled box with the content in it, and that the bar is themed rather than the
// OS's. Anything about the bar's size is layout, which jsdom does not do.
describe('ScrollArea', () => {
  test('puts its children in the scrolled viewport', () => {
    render(
      <ScrollArea className="flex-1">
        <p>a session row</p>
      </ScrollArea>,
    )
    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport?.contains(screen.getByText('a session row'))).toBe(true)
  })

  describe('while the content overflows', () => {
    beforeEach(overflow)

    test('the thumb is drawn from our tokens, not the OS scrollbar', async () => {
      // A scrollbar reads its root's context, so it is rendered inside one rather than bare.
      render(<ScrollArea>content</ScrollArea>)
      // The viewport measures itself after mounting, so the bar comes a moment later.
      const thumb = await waitFor(() => part('thumb'))
      // muted-foreground rather than border: a border-toned thumb vanishes on the dark canvas.
      expect(thumb.className).toContain('bg-muted-foreground/40')
      expect(thumb.className).toContain('rounded-full')
    })

    test('the bar is a slim vertical strip down the edge', async () => {
      render(<ScrollArea>content</ScrollArea>)
      const bar = await waitFor(() => part('scrollbar'))
      expect(bar.className).toContain('h-full w-2.5')
      expect(bar.getAttribute('data-orientation')).toBe('vertical')
    })
  })
})

import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ScrollArea } from './scroll-area.js'

afterEach(cleanup)

// #913: the panels' scrolled content moved inside a component, so the thing worth pinning is that
// it is still one scrolled box with the content in it, and that the bar is themed rather than the
// OS's. Anything about the bar's size or visibility is layout, which jsdom does not do.
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

  test('the thumb is drawn from our tokens, not the OS scrollbar', () => {
    // A scrollbar reads its root's context, so it is rendered inside one rather than bare.
    render(<ScrollArea>content</ScrollArea>)
    const thumb = document.querySelector('[data-slot="scroll-area-thumb"]')
    // muted-foreground rather than border: a border-toned thumb vanishes on the dark canvas.
    expect(thumb?.className).toContain('bg-muted-foreground/40')
    expect(thumb?.className).toContain('rounded-full')
  })

  test('the bar is a slim vertical strip down the edge', () => {
    render(<ScrollArea>content</ScrollArea>)
    const bar = document.querySelector('[data-slot="scroll-area-scrollbar"]')
    expect(bar?.className).toContain('h-full w-2.5')
    expect(bar?.getAttribute('data-orientation')).toBe('vertical')
  })
})

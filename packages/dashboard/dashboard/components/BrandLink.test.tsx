import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BrandLink } from './BrandLink.js'

afterEach(cleanup)

const brand = () => screen.getByRole('link', { name: /OpenAgent/ })

// #909: the mark is the way home. These pin both halves of that — the client-side navigation on a
// plain click, and that it is still a real link, which is what cmd-click and "copy link address"
// need. A button could not have the second half.
describe('BrandLink', () => {
  test('is a link to the Overview', () => {
    render(<BrandLink working={false} onNavigate={vi.fn()} />)
    expect(brand().getAttribute('href')).toBe('/')
  })

  test('a plain click navigates in-app rather than reloading', () => {
    const onNavigate = vi.fn()
    render(<BrandLink working={false} onNavigate={onNavigate} />)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(brand(), event)
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  test('leaves a modified click to the browser, so it can open a second Overview', () => {
    const onNavigate = vi.fn()
    render(<BrandLink working={false} onNavigate={onNavigate} />)
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true })
      fireEvent(brand(), event)
      expect(event.defaultPrevented, modifier).toBe(false)
    }
    // The middle click a new tab is usually opened with.
    const middle = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 })
    fireEvent(brand(), middle)
    expect(middle.defaultPrevented).toBe(false)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  test('folds the wordmark away below sm so the nav fits a narrow viewport (#980)', () => {
    // jsdom has no layout engine and does not apply the utility CSS, so the actual hide can only
    // be proved by driving a real browser (done for the PR). This just pins that the wordmark keeps
    // its responsive class, so a future tidy-up cannot silently bring the overflow back. The mark
    // stays visible either way, and it is still the link home (#909).
    const { container } = render(<BrandLink working={false} onNavigate={vi.fn()} />)
    const wordmark = screen.getByText('OpenAgent')
    expect(wordmark.classList.contains('max-sm:hidden')).toBe(true)
    // Never a bare `hidden`: a tool page's own `.hidden` would then hide the word at every width.
    expect(wordmark.classList.contains('hidden')).toBe(false)
    expect(container.querySelector('svg')).not.toBeNull() // the mark is not hidden
  })

  test('carries the working state through to the mark', () => {
    const { container, rerender } = render(<BrandLink working onNavigate={vi.fn()} />)
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('url(#hexknot-0)')
    rerender(<BrandLink working={false} onNavigate={vi.fn()} />)
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('var(--logo-1)')
  })
})

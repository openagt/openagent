import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ViewToggle } from './ViewToggle.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.cookie = 'openagent-view=; Max-Age=0; path=/'
})

// #1919: the toggle is there only where the dashboard answers the website's own name, which the
// server says with the view cookie, and it is there at once, for the switch's first frame.
describe('ViewToggle', () => {
  test('nothing without the view cookie: localhost:4200 and servers have no landing page', () => {
    const { container } = render(<ViewToggle />)
    expect(container.innerHTML).toBe('')
  })

  test('with the cookie, at once: the landing page is a plain link, the dashboard the lit side', () => {
    document.cookie = 'openagent-view=dashboard; path=/'
    render(<ViewToggle />)
    expect(screen.getByRole('link', { name: 'Landing page' }).getAttribute('href')).toBe('/_view/landing')
    expect(screen.getByText('Dashboard').getAttribute('aria-current')).toBe('page')
  })

  test('the switch takes the place of the page in the history, so Back leaves the dashboard; a Ctrl+click is the browser\'s', () => {
    document.cookie = 'openagent-view=dashboard; path=/'
    const replace = vi.fn()
    vi.stubGlobal('location', { replace })
    render(<ViewToggle />)
    const landing = screen.getByRole('link', { name: 'Landing page' })
    expect(fireEvent.click(landing, { ctrlKey: true })).toBe(true)
    expect(replace).not.toHaveBeenCalled()
    expect(fireEvent.click(landing)).toBe(false)
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/\/_view\/landing$/))
  })
})

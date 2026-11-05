import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ViewToggle } from './ViewToggle.js'

afterEach(() => {
  cleanup()
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
})

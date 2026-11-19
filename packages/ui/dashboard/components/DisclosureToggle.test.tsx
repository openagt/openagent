import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DisclosureToggle } from './DisclosureToggle.js'

afterEach(cleanup)

describe('DisclosureToggle (#659)', () => {
  test('renders its label and toggles on click, reflecting open in aria-expanded', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <DisclosureToggle open={false} onToggle={onToggle}>
        Context
      </DisclosureToggle>,
    )
    const button = screen.getByRole('button', { name: /Context/ })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(
      <DisclosureToggle open={true} onToggle={onToggle}>
        Context
      </DisclosureToggle>,
    )
    expect(screen.getByRole('button', { name: /Context/ }).getAttribute('aria-expanded')).toBe('true')
  })
})

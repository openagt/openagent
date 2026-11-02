import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Logo, logoLabel, logoSpokenLabel } from './Logo.js'

afterEach(cleanup)

// #875: the mark is the ambient "is the AI working for you" signal. These pin the two states
// apart — same knot, different fills — and that the label says which one you are looking at.
describe('Logo', () => {
  test('idle wears the neutral ramp and animates nothing', () => {
    const { container } = render(<Logo />)
    const fills = [...container.querySelectorAll('path')].map(p => p.getAttribute('fill'))
    expect(fills).toEqual(['var(--logo-1)', 'var(--logo-2)', 'var(--logo-3)', 'var(--logo-4)', 'var(--logo-5)', 'var(--logo-6)'])
    expect(container.querySelectorAll('animate').length).toBe(0)
  })

  test('working paints every strand from an animated gradient', () => {
    const { container } = render(<Logo working />)
    const fills = [...container.querySelectorAll('path')].map(p => p.getAttribute('fill'))
    expect(fills).toEqual([0, 1, 2, 3, 4, 5].map(i => `url(#hexknot-${i})`))
    // Six strands, two stops each, one animation per stop.
    expect(container.querySelectorAll('linearGradient').length).toBe(6)
    expect(container.querySelectorAll('animate').length).toBe(12)
  })

  test('every hue cycle closes on the hue it opened with, so the loop does not jump', () => {
    const { container } = render(<Logo working />)
    for (const animate of container.querySelectorAll('animate')) {
      const hues = (animate.getAttribute('values') ?? '').split(';')
      expect(hues.length).toBe(7)
      expect(hues.at(-1)).toBe(hues[0])
      expect(new Set(hues).size).toBe(6)
    }
  })

  test('the label says which state the mark is in', () => {
    expect(logoLabel(true)).toBe('AI is working for you 🚀')
    expect(logoLabel(false)).toBe("AI isn't working for you 💤")
    render(<Logo working />)
    expect(screen.getByRole('img', { name: logoSpokenLabel(true) })).toBeTruthy()
  })
})

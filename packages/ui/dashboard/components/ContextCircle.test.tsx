import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ContextCircle, tokenWords } from './ContextCircle.js'

afterEach(cleanup)

// How full the session's context is: a circle that says its own numbers, and nothing at all when
// one of them is missing — a fullness nobody can measure is worse than none.
describe('the context circle', () => {
  test('it says what is used, what the model holds, and how much is left', () => {
    render(<ContextCircle used={50_000} size={200_000} />)
    expect(screen.getByRole('img', { name: '50.0k of 200k used · 75% of the context left' })).toBeTruthy()
  })

  test('a full window is full, never more', () => {
    render(<ContextCircle used={300_000} size={272_000} />)
    expect(screen.getByRole('img', { name: /0% of the context left/ })).toBeTruthy()
  })

  test('no reading and no window mean no circle', () => {
    const { container, rerender } = render(<ContextCircle used={0} size={200_000} />)
    expect(container.textContent).toBe('')
    rerender(<ContextCircle used={1_000} size={0} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  test('a count reads the way a person says it', () => {
    expect(tokenWords(840)).toBe('840')
    expect(tokenWords(18_240)).toBe('18.2k')
    expect(tokenWords(184_000)).toBe('184k')
    expect(tokenWords(1_200_000)).toBe('1.2M')
    // A session's live line as Claude Code says it, never "8079.4k"; nor "1000k" on the way to a million.
    expect(tokenWords(8_079_400)).toBe('8.1M')
    expect(tokenWords(999_700)).toBe('1.0M')
  })
})

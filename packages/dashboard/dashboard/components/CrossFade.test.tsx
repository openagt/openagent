import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { CROSS_FADE_MS, CrossFade } from './CrossFade.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('CrossFade', () => {
  test('words shown first are there at once, with no fade', () => {
    const { container } = render(<CrossFade id="a">Starting session</CrossFade>)
    expect(container.textContent).toBe('Starting session')
    expect(container.querySelector('.cross-fade-in')).toBeNull()
    expect(container.querySelector('.cross-fade-out')).toBeNull()
  })

  test('new words fade in over the old ones fading out, and the old ones are gone once they have', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<CrossFade id="a">Setting up</CrossFade>)
    rerender(<CrossFade id="b">Cloning repository</CrossFade>)
    const out = container.querySelector('.cross-fade-out')
    expect(out?.textContent).toBe('Setting up')
    expect(out?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.cross-fade-in')?.textContent).toBe('Cloning repository')
    act(() => void vi.advanceTimersByTime(CROSS_FADE_MS + 50))
    expect(container.querySelector('.cross-fade-out')).toBeNull()
    expect(container.textContent).toBe('Cloning repository')
  })

  test('the same words with new content inside change in place, with no fade', () => {
    const { container, rerender } = render(<CrossFade id="a">Running 1</CrossFade>)
    rerender(<CrossFade id="a">Running 2</CrossFade>)
    expect(container.textContent).toBe('Running 2')
    expect(container.querySelector('.cross-fade-out')).toBeNull()
  })

  test('words changed again before the last ones are gone leave one fading copy of each', () => {
    const { container, rerender } = render(<CrossFade id="a">one</CrossFade>)
    rerender(<CrossFade id="b">two</CrossFade>)
    rerender(<CrossFade id="c">three</CrossFade>)
    expect([...container.querySelectorAll('.cross-fade-out')].map(node => node.textContent)).toEqual(['one', 'two'])
    expect(container.querySelector('.cross-fade-in')?.textContent).toBe('three')
  })
})

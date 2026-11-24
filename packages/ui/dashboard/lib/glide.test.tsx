import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useGlide } from './glide.js'

// jsdom lays nothing out and animates nothing: each row stands where the test puts it, 32 apart in
// the order drawn, and what a row is asked to animate is kept. The suite's setup answers every
// page as one that asked for less motion: here it asks for none less, but for the last test.
const animate = vi.fn()
beforeEach(() => {
  animate.mockReset()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Element.prototype.animate = animate as unknown as Element['animate']
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rows = [...document.querySelectorAll('[data-glide]')]
    const top = this.hasAttribute('data-glide') ? rows.indexOf(this) * 32 : 0
    return { top, bottom: top + 32, left: 0, right: 200, width: 200, height: 32, x: 0, y: top, toJSON: () => ({}) }
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (Element.prototype as { animate?: unknown }).animate
})

function Lists({ waiting, log }: { waiting: string[]; log: string[] }) {
  const root = useRef<HTMLDivElement>(null)
  useGlide(root)
  const row = (part: string) => (key: string) => (
    <div key={key} data-glide={key} data-glide-part={part}>
      <span data-glide-new>mark</span>
      {key}
    </div>
  )
  return (
    <div ref={root}>
      {waiting.map(row('waiting'))}
      {log.map(row('log'))}
    </div>
  )
}

/** What each row was asked to animate, by its key: its first frame's transform, or "fade" for one that only came in. */
const moves = () => Object.fromEntries(animate.mock.contexts.flatMap((row, at) => ((row as HTMLElement).dataset['glide'] ? [[(row as HTMLElement).dataset['glide'], (animate.mock.calls[at]![0] as Keyframe[])[0]!['transform'] ?? 'fade']] : [])))

describe('useGlide', () => {
  test('a row that changes part travels from where it stood, the rows it passes make room, and what it gains comes in on the way', () => {
    const { rerender } = render(<Lists waiting={['w']} log={['a', 'x', 'b']} />)
    expect(animate).not.toHaveBeenCalled()
    // "x" asks a question: it leaves the Log's second place for the top of what waits.
    rerender(<Lists waiting={['x', 'w']} log={['a', 'b']} />)
    expect(moves()).toEqual({ x: 'translateY(64px)', w: 'translateY(-32px)', a: 'translateY(-32px)' })
    // The travelling row is drawn over the others, and its new mark fades in.
    const mover = animate.mock.calls[animate.mock.contexts.findIndex(row => (row as HTMLElement).dataset['glide'] === 'x')]![0] as Keyframe[]
    expect(mover.every(frame => frame['zIndex'] === 20)).toBe(true)
    expect(animate.mock.contexts.some(part => (part as HTMLElement).hasAttribute('data-glide-new') && (part as HTMLElement).parentElement!.dataset['glide'] === 'x')).toBe(true)
  })

  test('a list drawn again, or with a new row, moves nothing: only a change of part does', () => {
    const { rerender } = render(<Lists waiting={[]} log={['a', 'b']} />)
    rerender(<Lists waiting={[]} log={['a', 'b']} />)
    rerender(<Lists waiting={[]} log={['new', 'a', 'b']} />)
    expect(animate).not.toHaveBeenCalled()
  })

  test('a row new to the page as another changes part fades in where it stands', () => {
    const { rerender } = render(<Lists waiting={[]} log={['x', 'a']} />)
    rerender(<Lists waiting={['x', 'other']} log={['a']} />)
    expect(moves()).toMatchObject({ other: 'fade' })
  })

  test('nothing moves for a person who asked for less motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    const { rerender } = render(<Lists waiting={[]} log={['x', 'a']} />)
    rerender(<Lists waiting={['x']} log={['a']} />)
    expect(animate).not.toHaveBeenCalled()
  })
})

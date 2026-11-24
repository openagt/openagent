import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { StateCell, type WorkState } from './state.js'

afterEach(cleanup)

/** What a state's mark is drawn of, colour aside: its shapes and whether it pulses. */
function shape(state: WorkState): string {
  const svg = render(<StateCell state={state} />).container.querySelector('svg')!
  if (svg.classList.contains('lucide-git-merge')) {
    cleanup()
    return 'merge glyph'
  }
  const parts = [...svg.children].map(part => (part.tagName === 'polygon' && part.getAttribute('fill') === 'none' ? (part.getAttribute('stroke-dasharray') ? 'dashed ring' : 'ring') : part.tagName === 'polygon' ? 'cell' : part.tagName))
  const pulses = svg.classList.contains('motion-safe:animate-pulse')
  cleanup()
  return `${parts.join('+')}${pulses ? ' pulsing' : ''}`
}

describe('StateCell', () => {
  test('what is alive pulses as a solid cell, what is done is an outline, and the rest keep a shape of their own', () => {
    const shapes = (['working', 'waiting', 'done', 'failed', 'merged', 'stopped', 'queued', 'idle'] as const).map(state => [state, shape(state)])
    expect(Object.fromEntries(shapes)).toEqual({
      working: 'cell pulsing',
      waiting: 'cell pulsing',
      done: 'ring',
      failed: 'cell+path',
      merged: 'merge glyph',
      stopped: 'ring+cell',
      queued: 'dashed ring',
      idle: 'ring',
    })
  })

  test('working and waiting are told apart by their colour, and a done mark carries none', () => {
    const tone = (state: WorkState) => {
      const classes = render(<StateCell state={state} />).container.querySelector('svg')!.getAttribute('class')!
      cleanup()
      return classes.match(/text-[a-z-]+/)?.[0]
    }
    expect([tone('working'), tone('waiting'), tone('done')]).toEqual(['text-info', 'text-warning', 'text-faint-foreground'])
  })
})

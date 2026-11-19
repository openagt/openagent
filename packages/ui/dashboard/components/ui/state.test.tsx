import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { StateCell, type WorkState } from './state.js'

afterEach(cleanup)

/** What a state's mark is drawn of, colour aside: its shapes and whether one turns. */
function shape(state: WorkState): string {
  const svg = render(<StateCell state={state} />).container.querySelector('svg')!
  if (svg.classList.contains('lucide-git-merge')) {
    cleanup()
    return 'merge glyph'
  }
  const parts = [...svg.children].map(part => (part.tagName === 'polygon' && part.getAttribute('fill') === 'none' ? (part.getAttribute('stroke-dasharray') ? 'dashed ring' : 'ring') : part.tagName === 'polygon' ? 'cell' : part.tagName))
  const turns = svg.querySelector('.motion-safe\\:animate-spin') !== null
  cleanup()
  return `${parts.join('+')}${turns ? ' turning' : ''}`
}

describe('StateCell', () => {
  test('each state is told apart by its shape, not by its colour alone', () => {
    const shapes = (['working', 'waiting', 'done', 'failed', 'merged', 'stopped', 'queued', 'idle'] as const).map(state => [state, shape(state)])
    expect(Object.fromEntries(shapes)).toEqual({
      working: 'ring+cell turning',
      waiting: 'ring+cell',
      done: 'cell',
      failed: 'cell+path',
      merged: 'merge glyph',
      stopped: 'ring+cell',
      queued: 'dashed ring',
      idle: 'ring',
    })
  })
})

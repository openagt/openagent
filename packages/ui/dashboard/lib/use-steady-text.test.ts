import { afterEach, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { pastWholeBlocks, toWordEnd, useSteadyText } from './use-steady-text.js'

test('the text shows on to the end of the word its pace reached, never half a word', () => {
  expect(toWordEnd('The sea is wide', 5)).toBe(7)
  expect(toWordEnd('The sea is wide', 3)).toBe(3)
  expect(toWordEnd('The sea is wide', 13)).toBe(15)
  expect(toWordEnd('The sea', 40)).toBe(7)
  // Nothing yet is nothing, never the whole text.
  expect(toWordEnd('The sea', 0)).toBe(0)
  expect(toWordEnd('The sea', -1)).toBe(0)
})

const table = '| A | B |\n| - | - |\n| 1 | 2 |\n'
const story = `The sea is wide.\n\n${table}\nIt ends here.`

test('a table comes in whole: the pace that reaches into it moves to its end', () => {
  const start = story.indexOf('|')
  expect(pastWholeBlocks(story, start + 3, true).at).toBe(start + table.length)
  expect(pastWholeBlocks(story, start + 3, false).at).toBe(start + table.length)
  // Before it, and after it, the pace is the pace.
  expect(pastWholeBlocks(story, 4, false)).toEqual({ at: 4, limit: story.length })
  expect(pastWholeBlocks(story, start + table.length + 2, false).at).toBe(start + table.length + 2)
})

test('a table the text is still in the middle of waits, with the words before it all shown', () => {
  const writing = 'The sea is wide.\n\n| A | B |\n| - | - |\n| 1'
  const start = writing.indexOf('|')
  expect(pastWholeBlocks(writing, 5, false)).toEqual({ at: 5, limit: start })
  expect(pastWholeBlocks(writing, 30, false)).toEqual({ at: start, limit: start })
  // The message the writing became is final: the table is as much as there is of it.
  expect(pastWholeBlocks(writing, start + 3, true)).toEqual({ at: writing.length, limit: writing.length })
})

test('a code block comes in whole too, and one with no closing fence yet waits', () => {
  const code = 'Run:\n\n```sh\nls\npwd\n```\nDone.'
  const start = code.indexOf('```')
  expect(pastWholeBlocks(code, start + 4, false).at).toBe(code.indexOf('\nDone.') + 1)
  const open = 'Run:\n\n```sh\nls'
  expect(pastWholeBlocks(open, open.length, false)).toEqual({ at: start, limit: start })
})

const matchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = matchMedia
  vi.useRealTimers()
})

test('a message that ends in a code block still open shows whole once it is final, with the same text', async () => {
  window.matchMedia = (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList
  // One clock for the frames and for the pace they are measured by.
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
  const text = 'Run this in the project:\n\n```sh\nls -la'
  const { result, rerender } = renderHook(({ final }) => useSteadyText(text, true, final), { initialProps: { final: false } })
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(result.current.shown).toBe('Run this in the project:\n\n')
  rerender({ final: true })
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(result.current.shown).toBe(text)
})

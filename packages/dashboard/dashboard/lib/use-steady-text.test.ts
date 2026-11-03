import { expect, test } from 'vitest'
import { toWordEnd } from './use-steady-text.js'

test('the text shows on to the end of the word its pace reached, never half a word', () => {
  expect(toWordEnd('The sea is wide', 5)).toBe(7)
  expect(toWordEnd('The sea is wide', 3)).toBe(3)
  expect(toWordEnd('The sea is wide', 13)).toBe(15)
  expect(toWordEnd('The sea', 40)).toBe(7)
  // Nothing yet is nothing, never the whole text.
  expect(toWordEnd('The sea', 0)).toBe(0)
  expect(toWordEnd('The sea', -1)).toBe(0)
})

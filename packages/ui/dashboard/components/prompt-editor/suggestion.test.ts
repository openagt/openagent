import { expect, test } from 'vitest'
import { menuLeft } from './suggestion.js'

test('the menu starts at the caret where the whole of it fits on the screen', () => {
  expect(menuLeft(434, 320, 1280)).toBe(434)
})

test('a caret near the right edge has the menu as far left as keeps all of it on the screen', () => {
  // A phone, a few words typed: the caret at 236 of 390, the menu 320 wide.
  expect(menuLeft(236, 320, 390)).toBe(62)
  expect(menuLeft(1270, 320, 1280)).toBe(952)
})

test('a screen narrower than the menu keeps the menu’s start on it', () => {
  expect(menuLeft(100, 320, 300)).toBe(8)
  expect(menuLeft(2, 320, 1280)).toBe(8)
})

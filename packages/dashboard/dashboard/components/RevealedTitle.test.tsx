import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { RevealedTitle } from './RevealedTitle.js'

afterEach(cleanup)

const letters = (container: HTMLElement) => container.querySelectorAll('.letter-in').length

test('a title that was waited for comes in letter by letter', () => {
  const { container } = render(<RevealedTitle text="Git cheat sheet" start />)
  expect(letters(container)).toBe('Git cheat sheet'.length)
  expect(container.textContent).toBe('Git cheat sheet')
})

test('a title shown at once, as a session opened later has one, is plain text', () => {
  const { container } = render(<RevealedTitle text="Old session" start={false} />)
  expect(letters(container)).toBe(0)
  expect(container.textContent).toBe('Old session')
})

test("the header and the list reveal one title together: the second box goes on from where the first was", () => {
  const first = render(<RevealedTitle text="Shared name here" start />)
  const second = render(<RevealedTitle text="Shared name here" start={false} />)
  // The second was drawn plain on its own, but a reveal of this title is under way, so it joins it.
  expect(letters(second.container)).toBe('Shared name here'.length)
  first.unmount()
})

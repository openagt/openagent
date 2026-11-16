import { afterEach, expect, test, vi } from 'vitest'
import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useHold } from './hold.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function List({ value }: { value: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const held = useHold(ref, value)
  return (
    <>
      <div ref={ref} data-testid="list">
        <button type="button">A row</button>
        <span>{held}</span>
      </div>
      <button type="button">Elsewhere</button>
    </>
  )
}

/** jsdom never shows a focus: here, every focus is shown, as the keyboard's is. */
function shownFocus(): void {
  const matches = Element.prototype.matches
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' || matches.call(this, selector)
  })
}

test('the pointer in it holds what it drew; what arrived applies once the pointer leaves', () => {
  const page = render(<List value="first" />)
  fireEvent.pointerEnter(screen.getByTestId('list'))
  page.rerender(<List value="second" />)
  expect(screen.getByText('first')).toBeTruthy()
  fireEvent.pointerLeave(screen.getByTestId('list'))
  expect(screen.getByText('second')).toBeTruthy()
})

test('the keyboard shown in it holds it, from one control in it to the next, until it leaves', () => {
  shownFocus()
  const page = render(<List value="first" />)
  act(() => screen.getByRole('button', { name: 'A row' }).focus())
  page.rerender(<List value="second" />)
  expect(screen.getByText('first')).toBeTruthy()
  act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())
  expect(screen.getByText('second')).toBeTruthy()
})

test('a focus a click left, not shown, does not hold it, or one click would freeze it until the next', () => {
  const page = render(<List value="first" />)
  act(() => screen.getByRole('button', { name: 'A row' }).focus())
  page.rerender(<List value="second" />)
  expect(screen.getByText('second')).toBeTruthy()
})

test('with the pointer and the keyboard both in it, it holds until both have left', () => {
  shownFocus()
  const page = render(<List value="first" />)
  fireEvent.pointerEnter(screen.getByTestId('list'))
  act(() => screen.getByRole('button', { name: 'A row' }).focus())
  page.rerender(<List value="second" />)
  fireEvent.pointerLeave(screen.getByTestId('list'))
  expect(screen.getByText('first')).toBeTruthy()
  act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())
  expect(screen.getByText('second')).toBeTruthy()
})

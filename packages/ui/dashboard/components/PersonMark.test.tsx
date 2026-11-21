import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PersonMark, personLetters, personName } from './PersonMark.js'

afterEach(cleanup)

const PICTURE = 'https://avatars.githubusercontent.com/u/1'

describe('whose letters', () => {
  test("a person goes by the name git knows, else their email's name, or its domain where the name is a generic word", () => {
    expect(personName('suleiman@averotech.com')).toBe('suleiman')
    expect(personName('git@brillout.com')).toBe('brillout')
    expect(personName('someone')).toBe('someone')
    // GitHub's own address for an account: its login, not the number before it.
    expect(personName('1005638+brillout@users.noreply.github.com')).toBe('brillout')
    expect(personLetters(personName('1005638+brillout@users.noreply.github.com'))).toBe('BR')
    expect(personName('1005638+brillout@x.dev')).toBe('1005638+brillout')
    // The name git knows them by comes first.
    expect(personName('git@brillout.com', 'Romuald Brillout')).toBe('Romuald Brillout')
    expect(personName('git@brillout.com', '  ')).toBe('brillout')
  })

  test('two letters: the first and last word of a name, else its first two', () => {
    expect(personLetters('Romuald Brillout')).toBe('RB')
    expect(personLetters('new.person')).toBe('NP')
    expect(personLetters('suleiman')).toBe('SU')
  })
})

describe('PersonMark', () => {
  test('letters until the picture has landed, then the picture alone', () => {
    const { container } = render(<PersonMark email="ada@x.dev" name="Ada Lovelace" picture={PICTURE} />)
    const picture = container.querySelector('img')!
    expect(picture.getAttribute('src')).toBe(PICTURE)
    expect(container.textContent).toBe('AL')
    fireEvent.load(picture)
    expect(container.textContent).toBe('')
    expect(container.querySelector('img')).toBeTruthy()
  })

  test('a picture that does not load gives way to the letters, and a new picture gets its chance', () => {
    const { container, rerender } = render(<PersonMark email="ada@x.dev" picture={PICTURE} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('AD')
    rerender(<PersonMark email="ada@x.dev" picture={`${PICTURE}?v=2`} />)
    expect(container.querySelector('img')).toBeTruthy()
  })

  test('with no email an empty circle, for a row whose person is on the way', () => {
    const { container } = render(<PersonMark />)
    expect(container.textContent).toBe('')
    expect(container.querySelector('img')).toBeNull()
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true')
  })

  test('it says who when it is told to; else it is left to what is around it', () => {
    const { container, rerender } = render(<PersonMark email="ada@x.dev" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.firstElementChild!.getAttribute('title')).toBeNull()
    rerender(<PersonMark email="ada@x.dev" said="ada@x.dev · ada" />)
    expect(screen.getByRole('img', { name: 'ada@x.dev · ada' }).getAttribute('title')).toBe('ada@x.dev · ada')
  })
})

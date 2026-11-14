import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { List, Row } from './list.js'
import { InSection, Section } from './section.js'

afterEach(cleanup)

const LONG = 'Move the release notes for every package into one page the website renders, and link each version from its own changelog'

describe('Row', () => {
  test('with an address, the row is a link named by its whole title: a plain click stays in the page, Ctrl+click is the browser’s', () => {
    const onClick = vi.fn()
    const remove = vi.fn()
    render(
      <List>
        <Row title={LONG} meta="4h ago" href="/shop/agents/a1" onClick={onClick} actions={<button type="button" onClick={remove}>Remove</button>} />
      </List>,
    )
    const link = screen.getByRole('link', { name: LONG })
    expect(link.getAttribute('href')).toBe('/shop/agents/a1')
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true)
    expect(onClick).not.toHaveBeenCalled()
    expect(fireEvent.click(link)).toBe(false)
    expect(onClick).toHaveBeenCalledOnce()
    // The row's own action is its own press, not the link's.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(remove).toHaveBeenCalledOnce()
    expect(onClick).toHaveBeenCalledOnce()
  })

  test('with only a press, the row is a button; with neither, its title is only said', () => {
    const onClick = vi.fn()
    render(
      <List>
        <Row title="shop" onClick={onClick} />
        <Row title="blog" />
      </List>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'shop' }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'blog' })).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  test('a second line under the title is the row\'s own: the link is named by the title alone, and the row is one height, 48', () => {
    render(
      <List>
        <Row title="Fix the login" detail="make the login page remember the email" href="/shop/agents/a1" />
        <Row title="Write the notes" href="/shop/agents/a2" />
      </List>,
    )
    const [two, one] = screen.getAllByRole('listitem')
    expect(screen.getByRole('link', { name: 'Fix the login' }).closest('li')).toBe(two)
    expect(two!.textContent).toBe('Fix the loginmake the login page remember the email')
    expect(two!.className.split(' ')).toEqual(expect.arrayContaining(['md:h-12', 'max-md:h-12']))
    expect(one!.className.split(' ')).toEqual(expect.arrayContaining(['md:h-10', 'max-md:h-11']))
  })

  test('a row with presses, link or not, is filled under the pointer, the keyboard and an open menu of its own, and its presses stay shown while that menu is open', () => {
    render(
      <List>
        <Row title="Default" actions={<button type="button" aria-expanded="false">Edit</button>} />
        <Row title="blog" />
      </List>,
    )
    const [withPresses, bare] = screen.getAllByRole('listitem')
    expect(withPresses!.className.split(' ')).toEqual(expect.arrayContaining(['hover:bg-accent', 'has-[:focus-visible]:bg-accent', 'has-[[aria-expanded=true]]:bg-accent']))
    expect(bare!.className).not.toContain('hover:bg-accent')
    expect(screen.getByRole('button', { name: 'Edit' }).parentElement!.className).toContain('pointer-fine:has-[[aria-expanded=true]]:opacity-100')
  })
})

describe('Section', () => {
  test('is named by its heading, not the count beside it', () => {
    render(
      <Section title="Runs" count="4 runs">
        <p>rows</p>
      </Section>,
    )
    expect(screen.getByRole('region', { name: 'Runs' }).textContent).toContain('rows')
    expect(screen.getByRole('heading', { name: 'Runs 4 runs' })).toBeTruthy()
  })

  test('inside another section, its heading is one level down', () => {
    render(
      <Section title="shop">
        <Section title="Priority 8">
          <p>rows</p>
        </Section>
      </Section>,
    )
    expect(screen.getByRole('heading', { name: 'shop', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Priority 8', level: 3 })).toBeTruthy()
  })

  test('under a heading said elsewhere (a dialog\'s title), a section is a group: one level down and a size smaller', () => {
    render(
      <InSection>
        <Section title="Every agent starts with">
          <p>skills</p>
        </Section>
      </InSection>,
    )
    expect(screen.getByRole('heading', { name: 'Every agent starts with', level: 3 }).className).toContain('text-sm')
  })
})

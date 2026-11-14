import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { List, Row } from './list.js'
import { Section } from './section.js'

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
})

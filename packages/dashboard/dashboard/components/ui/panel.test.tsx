import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Facts, Panel, PanelRow } from './panel.js'

afterEach(cleanup)

describe('Facts', () => {
  test('a dot between each two facts, drawn with the fact after it and not said, so a fact a phone leaves takes its dot along', () => {
    const { container } = render(<Facts facts={['3 runs', { fact: 'feature/login', className: 'max-md:sr-only' }, false, '', '2 commits']} />)
    const parts = [...container.firstElementChild!.children]
    // A fact that is nothing is left out, with no dot of its own.
    expect(parts.map(part => part.textContent)).toEqual(['3 runs', '·feature/login', '·2 commits'])
    expect(parts[0]!.querySelector('[aria-hidden]')).toBeNull()
    const branch = parts[1]!
    expect(branch.className).toBe('max-md:sr-only')
    expect(branch.querySelector('[aria-hidden]')!.textContent).toBe('·')
  })
})

describe('PanelRow', () => {
  test('its fact and its presses at rest are each a cell of the row of their own, after its parts, so a list lines each up down its rows', () => {
    render(
      <Panel>
        <PanelRow title="Login page" meta={['Needs push']} columns={<span>Claude Code</span>} fact="1m ago" actions={<button type="button">Review</button>} actionsAtRest href="#a" />
      </Panel>,
    )
    const row = screen.getByRole('listitem')
    const cells = [...row.children]
    expect(cells).toHaveLength(3)
    expect(cells[0]!.textContent).toContain('Login page')
    expect(cells[0]!.textContent).toContain('Claude Code')
    expect(cells[1]!.textContent).toBe('1m ago')
    expect(cells[2]!.contains(screen.getByRole('button', { name: 'Review' }))).toBe(true)
  })
})

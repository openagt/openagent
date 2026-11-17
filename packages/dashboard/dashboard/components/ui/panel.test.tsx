import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Facts, Panel, PanelRow } from './panel.js'

afterEach(cleanup)

describe('Facts', () => {
  test('a dot between each two facts, drawn with the fact after it and not said, so a fact a phone leaves takes its dot along', () => {
    const { container } = render(<Facts facts={['3 runs', { fact: 'feature/login', className: 'max-md:sr-only' }, false, '', '2 commits']} />)
    const run = container.firstElementChild!
    const parts = [...run.children]
    // A fact that is nothing is left out, with no dot of its own.
    expect(parts.map(part => part.textContent)).toEqual(['3 runs', '·feature/login', '·2 commits'])
    expect(parts[0]!.querySelector('[aria-hidden]')).toBeNull()
    expect(parts[1]!.className).toContain('max-md:sr-only')
    expect(parts[1]!.querySelector('[aria-hidden]')!.textContent).toBe('·')
    // A fact never breaks inside itself; the run wraps between facts, its dots' margin out to the left and cut off.
    expect(parts.every(part => part.className.includes('whitespace-nowrap'))).toBe(true)
    expect(run.className).toContain('flex-wrap')
    expect(run.className).toContain('-ml-4')
    expect(run.className).toContain('[clip-path:inset(0_0_0_1rem)]')
  })

  test('one line: its last fact gives way, the others keep their room; a lead opens it with no dot seen after it', () => {
    const { container } = render(<Facts oneLine lead={<b>Server</b>} facts={['Online', '203.0.113.5']} />)
    const run = container.firstElementChild!
    expect(run.className).not.toContain('flex-wrap')
    const [lead, online, address] = [...run.children]
    expect(lead!.textContent).toBe('Server')
    expect(online!.firstElementChild!.className).toContain('invisible')
    expect(online!.className).toContain('not-last:shrink-0')
    expect(address!.lastElementChild!.className).toContain('truncate')
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

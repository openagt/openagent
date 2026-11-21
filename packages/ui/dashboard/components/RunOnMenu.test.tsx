import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { hoverTooltip, openMenu } from '../test-utils.js'
import { RunOnMenu, type ConnectionControl } from './RunOnMenu.js'

afterEach(cleanup)

const ACTIONS = { id: 'actions', label: 'GitHub Actions' }

function renderMenu(over: Partial<ConnectionControl> = {}) {
  const connection: ConnectionControl = {
    onSelectLocal: vi.fn(),
    hosts: [ACTIONS],
    selectedHostId: null,
    onSelectHost: vi.fn(),
    ...over,
  }
  render(<RunOnMenu connection={connection} busy={false} />)
  return connection
}

const trigger = () => screen.getByRole('button', { name: /^Run on: / })

describe('the "Run on" pick in the row above the box (#2394)', () => {
  test('it reads "This machine" while no host is picked, drawn as the row draws its items: no border', () => {
    renderMenu()
    expect(trigger().textContent).toBe('This machine')
    expect(trigger().className).not.toContain('border')
    // An icon before the name and a chevron after it.
    expect(trigger().querySelectorAll('svg')).toHaveLength(2)
  })

  test("its menu lists this machine, then the project's hosts, each saying where it runs; a click picks", async () => {
    const connection = renderMenu()
    await openMenu(trigger())
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    expect(items[0]!.textContent).toBe('This machineRuns here, in this project.')
    expect(items[1]!.textContent).toBe('GitHub ActionsRuns this project on a machine of its own.')
    expect(items[1]!.querySelector('svg.lucide-workflow')).toBeTruthy()
    // Named, and the pick is the tick at the row's end; the other rows carry none.
    expect(screen.getByText('Run on')).toBeTruthy()
    expect(items.map(item => item.lastElementChild!.classList.contains('lucide-check'))).toEqual([true, false])

    fireEvent.click(items[1]!)
    expect(connection.onSelectHost).toHaveBeenCalledWith('actions')

    await openMenu(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /^This machine/ }))
    expect(connection.onSelectLocal).toHaveBeenCalled()
  })

  test('a session with no project runs here in a folder of its own, and the menu says so', async () => {
    renderMenu({ noProject: true })
    await openMenu(trigger())
    expect(screen.getByRole('menuitem', { name: /^This machine/ }).textContent).toContain('Runs here, in a folder of its own.')
  })

  test('a host picked: the words read its name with its mark, the tooltip says it, and the tick is on its row alone', async () => {
    renderMenu({ selectedHostId: 'actions' })
    expect(trigger().textContent).toBe('GitHub Actions')
    expect(trigger().querySelector('svg.lucide-workflow')).toBeTruthy()
    expect((await hoverTooltip(trigger())).textContent).toBe('Run on — GitHub Actions')
    await openMenu(trigger())
    expect(screen.getAllByRole('menuitem').map(item => item.lastElementChild!.classList.contains('lucide-check'))).toEqual([false, true])
  })

  test('a pick that names a host the project has not reads "This machine"', () => {
    renderMenu({ hosts: [], selectedHostId: 'actions' })
    expect(trigger().textContent).toBe('This machine')
  })
})

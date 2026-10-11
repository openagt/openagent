import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Machine } from '../lib/machines.js'
import { hoverTooltip, openMenu } from '../test-utils.js'
import { RunOnMenu, type ConnectionControl } from './RunOnMenu.js'

afterEach(cleanup)

const STUDIO: Machine = { id: 'studio', url: 'http://192.168.1.5:4200', label: 'Studio' }

function renderMenu(over: Partial<ConnectionControl> = {}, chip = true) {
  const connection: ConnectionControl = {
    machines: [STUDIO],
    selectedMachineId: null,
    onlyHere: false,
    onSelect: vi.fn(),
    onSelectLocal: vi.fn(),
    onAddMachine: vi.fn(),
    onRemove: vi.fn(),
    status: {},
    ...over,
  }
  render(<RunOnMenu connection={connection} busy={false} chip={chip} />)
  return connection
}

const trigger = () => screen.getByRole('button', { name: 'Run on' })

describe('the "Run on" pick as a chip', () => {
  test('it reads "This machine" while no machine is picked, and looks like a chip', () => {
    renderMenu()
    expect(trigger().textContent).toBe('This machine')
    expect(trigger().className).toContain('rounded-full')
    expect(trigger().className).toContain('border')
    // An icon before the name and a chevron after it.
    expect(trigger().querySelectorAll('svg')).toHaveLength(2)
  })

  test('it reads the picked machine\'s label, an offline one too, and a long label is cut short', () => {
    renderMenu({ selectedMachineId: 'studio', status: { studio: 'offline' } })
    expect(trigger().textContent).toBe('Studio')
    const name = screen.getByText('Studio')
    expect(name.className).toContain('truncate')
    expect(trigger().className).toContain('min-w-0')
  })

  test('a pick that names a removed machine reads "This machine"', () => {
    renderMenu({ selectedMachineId: 'gone' })
    expect(trigger().textContent).toBe('This machine')
  })

  test('a project with no repository address runs here only: the machines cannot be picked, a pick made elsewhere does not hold, and the menu says why', async () => {
    const connection = renderMenu({ onlyHere: true, selectedMachineId: 'studio' })
    expect(trigger().textContent).toBe('This machine')
    await openMenu(trigger())
    const studio = screen.getByRole('menuitem', { name: /^Studio/ })
    expect(studio.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(studio)
    expect(connection.onSelect).not.toHaveBeenCalled()
    expect(screen.getByText('This project has no repository address, so it cannot be sent to another machine.')).toBeTruthy()
  })

  test('its menu lists this machine, the machines and "Add a machine…", and a click picks', async () => {
    const connection = renderMenu({ selectedMachineId: 'studio' })
    await openMenu(trigger())
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(3)
    expect(items[0]!.textContent).toContain('This machine')
    expect(items[1]!.textContent).toContain('Studio')
    expect(items[2]!.textContent).toContain('Add a machine…')

    fireEvent.click(items[1]!)
    expect(connection.onSelect).toHaveBeenCalledWith(STUDIO)

    await openMenu(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /^This machine/ }))
    expect(connection.onSelectLocal).toHaveBeenCalled()
  })

  test('the X on a machine\'s row removes it and does not pick it', async () => {
    const connection = renderMenu()
    await openMenu(trigger())
    fireEvent.click(screen.getByRole('button', { name: 'Remove machine Studio' }))
    expect(connection.onRemove).toHaveBeenCalledWith(STUDIO)
    expect(connection.onSelect).not.toHaveBeenCalled()
  })
})

describe('the "Run on" pick as an icon button', () => {
  test('it shows no words, and its tooltip names the target', async () => {
    renderMenu({ selectedMachineId: 'studio' }, false)
    expect(trigger().textContent).toBe('')
    expect(trigger().className).not.toContain('rounded-full')
    expect((await hoverTooltip(trigger())).textContent).toBe('Run on — Studio')
  })

  test('its menu is the same one', async () => {
    const connection = renderMenu({}, false)
    await openMenu(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /^Studio/ }))
    expect(connection.onSelect).toHaveBeenCalledWith(STUDIO)
  })
})

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Machine } from '../lib/machines.js'
import { hoverTooltip, openMenu } from '../test-utils.js'
import { RunOnMenu, type ConnectionControl } from './RunOnMenu.js'

afterEach(cleanup)

const STUDIO: Machine = { id: 'studio', url: 'http://192.168.1.5:4200', label: 'Studio' }
// A person's own computer, reached by the line it keeps open to this server: saved by the address that stands for it here.
const MACBOOK: Machine = { id: 'macbook', url: 'http://127.0.0.1:4210', label: 'MacBook' }

function renderMenu(over: Partial<ConnectionControl> = {}, inRow = true) {
  const connection: ConnectionControl = {
    machines: [STUDIO],
    selectedMachineId: null,
    onlyHere: false,
    onSelect: vi.fn(),
    onSelectLocal: vi.fn(),
    onAddMachine: vi.fn(),
    status: {},
    ...over,
  }
  render(<RunOnMenu connection={connection} busy={false} inRow={inRow} />)
  return connection
}

const trigger = () => screen.getByRole('button', { name: 'Run on' })

describe('the "Run on" pick in the row under the box', () => {
  test('it reads "This machine" while no machine is picked, drawn as the row under the box draws its items: no border', () => {
    renderMenu()
    expect(trigger().textContent).toBe('This machine')
    expect(trigger().className).not.toContain('border')
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

  test('a machine is picked here and never removed: that is on its page under Devices, out of reach of a slip', async () => {
    renderMenu({ machines: [MACBOOK, STUDIO] })
    await openMenu(trigger())
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
  })

  test('a computer at home reached through a server says its own name, and what it is and where; the button says its name and the tooltip the whole', async () => {
    const via: Machine = { id: 'via', url: 'https://165.245.244.10/_devices/via/8687ab858ef6', label: 'experiment (through 165.245.244.10)' }
    renderMenu({ machines: [via], status: { via: 'online' }, selectedMachineId: 'via' })
    expect(trigger().textContent).toBe('experiment')
    expect((await hoverTooltip(trigger())).textContent).toBe('Run on — experiment (through 165.245.244.10)')
    await openMenu(trigger())
    const item = screen.getByRole('menuitem', { name: /^experiment/ })
    expect(item.textContent).toBe('experimentServer at home, through 165.245.244.10')
    expect(item.querySelector('svg.lucide-house')).toBeTruthy()
    // Never the address that stands for it.
    expect(item.textContent).not.toContain('_devices')
    cleanup()
    renderMenu({ machines: [via], status: { via: 'offline' } })
    await openMenu(trigger())
    expect(screen.getByRole('menuitem', { name: /^experiment/ }).textContent).toBe('experimentOffline · Server at home, through 165.245.244.10')
  })
})

describe('a saved machine that is a person\'s own computer, reached by the line it keeps open to this server', () => {
  const row = () => screen.getByRole('menuitem', { name: /^MacBook/ })

  test('its row draws a computer and says what it is, not the address that stands for it here; a server\'s row is as it was', async () => {
    renderMenu({ machines: [MACBOOK, STUDIO], status: { macbook: 'online', studio: 'online' } })
    await openMenu(trigger())
    expect(row().textContent).toBe('MacBookYour computer')
    expect(row().querySelector('svg.lucide-laptop')).toBeTruthy()
    expect(row().querySelector('svg.lucide-server')).toBeNull()
    const studio = screen.getByRole('menuitem', { name: /^Studio/ })
    expect(studio.textContent).toBe('StudioServer, 192.168.1.5:4200')
    cleanup()
    // A server named by its address says it once.
    const vps: Machine = { id: 'vps', url: 'https://165.245.244.10', label: '165.245.244.10' }
    renderMenu({ machines: [vps] })
    await openMenu(trigger())
    expect(screen.getByRole('menuitem', { name: /^165\.245\.244\.10/ }).textContent).toBe('165.245.244.10Server')
    expect(studio.querySelector('svg.lucide-server')).toBeTruthy()
    expect(studio.querySelector('svg.lucide-laptop')).toBeNull()
  })

  test('another person\'s computer, shared with everyone on this server, is drawn as a server and says whose it is and whose logins a run uses', async () => {
    const box: Machine = { id: 'box', url: 'http://127.0.0.1:4311', label: 'rom-desktop', owner: 'rom' }
    renderMenu({ machines: [box], status: { box: 'online' } })
    await openMenu(trigger())
    const item = screen.getByRole('menuitem', { name: /^rom-desktop/ })
    expect(item.textContent).toBe("rom-desktop@rom's server. Runs use your own logins.")
    expect(item.querySelector('svg.lucide-server')).toBeTruthy()
    expect(item.querySelector('svg.lucide-laptop')).toBeNull()
  })

  test('not connected, its row says what the computer needs', async () => {
    renderMenu({ machines: [MACBOOK], status: { macbook: 'offline' } })
    await openMenu(trigger())
    expect(row().textContent).toBe('MacBookNot connected. It must be on, with OpenAgent running.')
  })

  test('a click picks it', async () => {
    const connection = renderMenu({ machines: [MACBOOK, STUDIO] })
    await openMenu(trigger())
    fireEvent.click(row())
    expect(connection.onSelect).toHaveBeenCalledWith(MACBOOK)
  })

  test('picked, the words and the icon button draw a computer; a picked server draws a server', () => {
    for (const inRow of [true, false]) {
      renderMenu({ machines: [MACBOOK, STUDIO], selectedMachineId: 'macbook' }, inRow)
      expect(trigger().querySelector('svg.lucide-laptop')).toBeTruthy()
      expect(trigger().querySelector('svg.lucide-server')).toBeNull()
      cleanup()
      renderMenu({ machines: [MACBOOK, STUDIO], selectedMachineId: 'studio' }, inRow)
      expect(trigger().querySelector('svg.lucide-server')).toBeTruthy()
      expect(trigger().querySelector('svg.lucide-laptop')).toBeNull()
      cleanup()
    }
  })
})

// The dashboard is its own machine's, also on a phone: there "This machine" would read as the phone.
describe('the page opened from somewhere else than the computer it is on', () => {
  const page = (globalThis as unknown as { jsdom: { reconfigure(to: { url: string }): void } }).jsdom
  const own = window.location.href
  afterEach(() => page.reconfigure({ url: own }))

  test('the first row and the button say the name the page was reached at; the row\'s description stays, and a picked machine still reads by its label', async () => {
    page.reconfigure({ url: 'https://165.245.244.10/' })
    renderMenu()
    expect(trigger().textContent).toBe('165.245.244.10')
    expect((await hoverTooltip(trigger())).textContent).toBe('Run on — 165.245.244.10')
    await openMenu(trigger())
    const items = screen.getAllByRole('menuitem')
    expect(items[0]!.textContent).toBe('165.245.244.10Runs here, through this project\'s start hook.')
    fireEvent.click(items[0]!)
    cleanup()

    page.reconfigure({ url: 'http://suleimans-macbook-pro.local:4200/' })
    renderMenu()
    expect(trigger().textContent).toBe('suleimans-macbook-pro.local')
    cleanup()
    renderMenu({ selectedMachineId: 'studio' })
    expect(trigger().textContent).toBe('Studio')
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

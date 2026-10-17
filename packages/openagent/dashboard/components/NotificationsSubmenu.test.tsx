import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Preferences } from '../../src/index.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu.js'

const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  updatePreferences,
  notificationsEnabled: (p: Preferences) => p.notifyBrowser ?? true,
  newActivityEnabled: (p: Preferences) => p.notifyNewActivity ?? false,
  humanInterventionEnabled: (p: Preferences) => p.notifyHumanIntervention ?? true,
}))

const { NotificationsSubmenu } = await import('./NotificationsSubmenu.js')

/** The submenu as it stands in a menu, the person's at the sidebar's foot; `menu` opens it. */
const Menu = () => (
  <DropdownMenu>
    <DropdownMenuTrigger>menu</DropdownMenuTrigger>
    <DropdownMenuContent>
      <NotificationsSubmenu />
    </DropdownMenuContent>
  </DropdownMenu>
)

beforeEach(() => {
  prefs = {}
  updatePreferences.mockReset()
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The menu's Notifications row, the menu opened first. */
const row = () => {
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'menu' }))
  return screen.getByRole('menuitem', { name: /notifications/i })
}
const open = () => fireEvent.click(row())

describe('NotificationsSubmenu (#676)', () => {
  test('the popover groups the method and the categories, both "Human Queue" and "New activity" toggleable', async () => {
    render(<Menu />)
    open()
    expect(screen.getByText('Deliver to')).toBeTruthy()
    expect(screen.getByText('Browser')).toBeTruthy()
    expect(screen.getByText('Notify me about')).toBeTruthy()
    expect(screen.getByText('Human Queue')).toBeTruthy()
    expect(screen.queryByText('Always on')).toBeNull() // #627: now a real toggle, no static row
    expect(screen.getByText('New activity')).toBeTruthy()
  })

  test('toggling New activity and Human Queue writes each preference through', async () => {
    render(<Menu />)
    open()
    fireEvent.click(screen.getByText('New activity'))
    expect(updatePreferences).toHaveBeenCalledWith({ notifyNewActivity: true })
    // Defaults on, so the click turns it OFF (#627).
    fireEvent.click(screen.getByText('Human Queue'))
    expect(updatePreferences).toHaveBeenCalledWith({ notifyHumanIntervention: false })
  })

  test('enabling Browser asks for permission when it has not been granted yet', async () => {
    prefs = { notifyBrowser: false }
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() })
    render(<Menu />)
    open()
    fireEvent.click(screen.getByText('Browser'))
    expect(updatePreferences).toHaveBeenCalledWith({ notifyBrowser: true })
    expect((globalThis.Notification as unknown as { requestPermission: () => void }).requestPermission).toHaveBeenCalled()
  })

  test('the row says On when Browser is on and granted, Off otherwise', () => {
    const { rerender } = render(<Menu />) // default: browser on + granted
    expect(row().textContent).toBe('NotificationsOn')
    prefs = { notifyBrowser: false }
    rerender(<Menu />)
    expect(screen.getByRole('menuitem', { name: /notifications/i }).textContent).toBe('NotificationsOff')
  })

  test('a blocked browser permission disables the Browser toggle with a hint', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() })
    render(<Menu />)
    open()
    expect(screen.getByText('Blocked in your browser settings')).toBeTruthy()
  })

  test('Browser on but not yet granted reads Off', () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() })
    render(<Menu />)
    expect(row().textContent).toBe('NotificationsOff')
  })

  test('with no browser notification support the menu offers only the categories', async () => {
    vi.stubGlobal('Notification', undefined)
    render(<Menu />)
    open()
    expect(screen.queryByText('Deliver to')).toBeNull()
    expect(screen.getByText('Human Queue')).toBeTruthy()
  })
})

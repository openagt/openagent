import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu.js'

const updatePreferences = vi.hoisted(() => vi.fn())
const usePreferences = vi.hoisted(() => vi.fn())
// The whole module is mocked: importing it for real puts a preferences fetch behind a component
// test. `themePreference` is one line, so restating it costs less than that.
vi.mock('../lib/preferences.js', () => ({
  updatePreferences,
  usePreferences,
  themePreference: (p: { theme?: string }) => p.theme ?? 'system',
}))

const { ThemeSubmenu } = await import('./ThemeSubmenu.js')

afterEach(() => {
  cleanup()
  updatePreferences.mockReset()
})

/** The submenu as it stands in a menu, the person's at the sidebar's foot; `menu` opens it. */
const Menu = () => (
  <DropdownMenu>
    <DropdownMenuTrigger>menu</DropdownMenuTrigger>
    <DropdownMenuContent>
      <ThemeSubmenu />
    </DropdownMenuContent>
  </DropdownMenu>
)
/** The menu's Theme row, the menu opened first. */
const row = () => {
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'menu' }))
  return screen.getByRole('menuitem', { name: /theme/i })
}

// #754: the theme is an app-wide setting, reachable wherever the sidebar is, and it writes the one
// preference the rest of the app reads.
describe('ThemeSubmenu (#754)', () => {
  test('picking a theme persists it', async () => {
    usePreferences.mockReturnValue({ theme: 'system' })
    render(<Menu />)
    fireEvent.click(row())
    fireEvent.click(screen.getByText('Dark'))
    expect(updatePreferences).toHaveBeenCalledWith({ theme: 'dark' })
  })

  test('the row says the theme that is on, without opening it', () => {
    usePreferences.mockReturnValue({ theme: 'dark' })
    render(<Menu />)
    expect(row().textContent).toBe('ThemeDark')
  })

  test('an unset preference reads as system, the default', () => {
    usePreferences.mockReturnValue({})
    render(<Menu />)
    expect(row().textContent).toBe('ThemeSystem')
  })
})

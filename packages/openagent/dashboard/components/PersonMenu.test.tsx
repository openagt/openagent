import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const onPerson = vi.hoisted(() => vi.fn())
vi.mock('../rpc/person.js', () => ({ onPerson }))
// The menu's theme and notifications rows have their own suites; here they are the rows' names.
vi.mock('./ThemeSubmenu.js', () => ({ ThemeSubmenu: () => <div role="menuitem">Theme</div> }))
vi.mock('./NotificationsSubmenu.js', () => ({ NotificationsSubmenu: () => <div role="menuitem">Notifications</div> }))

const { PersonMenu, initials } = await import('./PersonMenu.js')

afterEach(() => {
  cleanup()
  onPerson.mockReset()
})

describe('PersonMenu', () => {
  test('the person\'s row: their picture and name, opening the theme, the notifications, and Settings', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada', avatar: 'https://avatars.githubusercontent.com/u/1' })
    const onSettings = vi.fn()
    const { container } = render(<PersonMenu onSettings={onSettings} />)
    const row = await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    expect(row.textContent).toBe('Ada Lovelace')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1')
    fireEvent.click(row)
    expect(screen.getByText('@ada')).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Theme', 'Notifications', 'Settings'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledTimes(1)
  })

  test('with no picture, or one that does not load, their initials', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', avatar: 'https://example.com/gone.png' })
    const { container } = render(<PersonMenu onSettings={() => {}} />)
    await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('AL')).toBeTruthy()
  })

  test('the row is marked while Settings is the page open', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace' })
    render(<PersonMenu atSettings onSettings={() => {}} />)
    expect((await screen.findByRole('button', { name: 'Ada Lovelace: settings' })).getAttribute('aria-current')).toBe('page')
  })

  test('initials: the first and last word\'s, or one for one word', () => {
    expect(initials('Suleiman Shahbari')).toBe('SS')
    expect(initials('Ada King Lovelace')).toBe('AL')
    expect(initials('octo')).toBe('O')
    expect(initials('  ')).toBe('?')
  })
})

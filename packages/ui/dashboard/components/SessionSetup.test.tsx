import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Bot } from 'lucide-react'
import { GearMenu, gear, hoverTooltip, openMenu, openSetupLine, setupLine } from '../test-utils.js'
import { SetupLine, SetupPress, SetupSaid } from './SessionSetup.js'
import { DropdownMenuItem } from './ui/dropdown-menu.js'

afterEach(cleanup)

const profileLine = (
  <SetupLine icon={<Bot aria-hidden />} label="Profile" value="Default">
    <DropdownMenuItem>Reviewer</DropdownMenuItem>
  </SetupLine>
)

describe('the gear under the message box', () => {
  test('named "Session setup", an icon alone, and its hover says the setup with the menu shut', async () => {
    render(<GearMenu lines={profileLine} said="Profile Default · 18 skills · @octo · Merge on green" />)
    expect(gear().textContent).toBe('')
    expect(gear().querySelector('svg')).toBeTruthy()
    expect((await hoverTooltip(gear())).textContent).toBe('Profile Default · 18 skills · @octo · Merge on green')
  })

  test('off while the box is busy', () => {
    render(<GearMenu lines={profileLine} busy />)
    expect((gear() as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    render(<GearMenu lines={profileLine} />)
    expect((gear() as HTMLButtonElement).disabled).toBe(false)
  })

  test("in the warning's colour while a line needs a press, and in the row's own otherwise", () => {
    render(<GearMenu lines={profileLine} warn />)
    expect(gear().className.split(' ')).toContain('text-warning')
    cleanup()
    render(<GearMenu lines={profileLine} />)
    expect(gear().className.split(' ')).not.toContain('text-warning')
  })

  test('its menu is headed "This session", holds the lines, and stands above the box', async () => {
    render(<GearMenu lines={profileLine} />)
    expect(screen.queryByRole('menu')).toBeNull()
    await openMenu(gear())
    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toBe('This sessionProfile: Default')
    expect(menu.closest('[data-side]')!.getAttribute('data-side')).toBe('top')
  })
})

describe("a line of the gear's menu", () => {
  test('one that opens a list reads "Label: value", and its list opens beside it', async () => {
    render(<GearMenu lines={profileLine} />)
    const line = await setupLine('Profile')
    expect(line.textContent).toBe('Profile: Default')
    expect(line.querySelector('svg.lucide-bot')).toBeTruthy()
    expect(screen.queryByText('Reviewer')).toBeNull()
    await openSetupLine('Profile')
    expect(await screen.findByRole('menuitem', { name: 'Reviewer' })).toBeTruthy()
  })

  test('one a session keeps from its start is said, not offered: no list, pressing it leaves the menu open, and it says why it stays', async () => {
    render(<GearMenu lines={<SetupSaid icon={<Bot aria-hidden />} label="Profile" value="Reviewer" tip="This session is on the profile Reviewer" />} />)
    const line = await setupLine('Profile')
    expect(line.textContent).toBe('Profile: Reviewer. This session is on the profile Reviewer')
    expect(line.getAttribute('aria-haspopup')).toBeNull()
    expect(line.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(line)
    expect(gear().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect((await hoverTooltip(line)).textContent).toBe('This session is on the profile Reviewer')
  })

  test("one that is a press runs it and closes the menu, its value in the warning's colour", async () => {
    const onClick = vi.fn()
    render(<GearMenu lines={<SetupPress icon={<Bot aria-hidden />} label="GitHub account" value="Add one…" onClick={onClick} />} />)
    const line = await setupLine('GitHub account')
    expect(line.textContent).toBe('GitHub account: Add one…')
    expect(screen.getByText('Add one…').className.split(' ')).toContain('text-warning')
    fireEvent.click(line)
    expect(onClick).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { GearMenu, hoverTooltip, setupLine } from '../test-utils.js'

vi.mock('../rpc/profiles.js', () => ({ onProfilesList: async () => ({ profiles: [{ id: 'default', name: 'Default', options: {} }, { id: 'reviewer', name: 'Reviewer', options: {} }], claude: [], codex: [] }) }))

const { ProfileOff } = await import('./ProfileMenu.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
})

describe("a session's profile in the gear's menu, said and not offered", () => {
  test('the profile by its name once the profiles are read, a line that opens no list, with what its hover says', async () => {
    render(<GearMenu lines={<ProfileOff profile="reviewer" />} />)
    const line = await setupLine('Profile')
    // No list opens from it, and a screen reader hears what it is and why it stays.
    expect(line.getAttribute('aria-haspopup')).toBeNull()
    expect(line.getAttribute('aria-disabled')).toBe('true')
    expect(line.textContent).toBe('Profile: Reviewer. This session is on the profile Reviewer: its accounts, and the project skills it gets')
    expect((await hoverTooltip(line)).textContent).toBe('This session is on the profile Reviewer: its accounts, and the project skills it gets')
  })

  test('a long name is the part cut short: the line keeps its label whole', async () => {
    render(<GearMenu lines={<ProfileOff profile="reviewer" />} />)
    const line = await setupLine('Profile')
    expect(screen.getByText('Reviewer').className.split(' ')).toContain('truncate')
    expect(line.firstElementChild!.nextElementSibling!.className.split(' ')).toContain('shrink-0')
  })

  test('a record that names no profile is on Default, said as the launcher says it; one this computer lacks, by its id', async () => {
    const { rerender } = render(<GearMenu lines={<ProfileOff profile={undefined} />} />)
    expect((await setupLine('Profile')).textContent).toMatch(/^Profile: Default\./)
    rerender(<GearMenu lines={<ProfileOff profile="elsewhere-made" />} />)
    expect((await setupLine('Profile')).textContent).toMatch(/^Profile: elsewhere-made\./)
  })
})

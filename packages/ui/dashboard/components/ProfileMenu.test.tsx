import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement, type ReactNode } from 'react'
import { forgetRemembered } from '../lib/use-async.js'

vi.mock('../rpc/profiles.js', () => ({ onProfilesList: async () => ({ profiles: [{ id: 'default', name: 'Default', options: {} }, { id: 'reviewer', name: 'Reviewer', options: {} }], claude: [], codex: [] }) }))
// What each item's hover says is on the page as a line, and its trigger is what holds the button.
vi.mock('./ui/tooltip.js', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: trigger, children }: { render: ReactElement; children: ReactNode }) => cloneElement(trigger, { 'data-hover': true } as never, children),
  TooltipContent: ({ children }: { children: ReactNode }) => <span role="tooltip">{children}</span>,
}))

const { ProfileOff } = await import('./ProfileMenu.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
})

describe("a session's profile under the box, as words", () => {
  test('the profile by its name once the profiles are read, as words the keyboard stops on, with what its hover says; nothing before', async () => {
    const { container } = render(<ProfileOff profile="reviewer" />)
    expect(container.textContent).toBe('')
    const said = (await screen.findByText('Reviewer')).closest<HTMLElement>('[data-hover]')!
    expect(said.tabIndex).toBe(0)
    expect(screen.queryByRole('button')).toBeNull()
    // A screen reader hears what it is and why it stays, as the launcher's says "Profile: Default".
    expect(said.textContent).toBe('Profile: Reviewer. This session is on the profile Reviewer: its accounts, and the project skills it gets')
    expect(screen.getByRole('tooltip').textContent).toBe('This session is on the profile Reviewer: its accounts, and the project skills it gets')
  })

  test('in a narrow box, as on a phone, the name still stands beside the robot, cut shorter instead of left to the icon', async () => {
    render(<ProfileOff profile="reviewer" />)
    const name = await screen.findByText('Reviewer')
    expect(name.className.split(' ')).not.toContain('@max-xl:sr-only')
    expect(name.className.split(' ')).toEqual(expect.arrayContaining(['truncate', '@max-xl:max-w-20']))
  })

  test('a record that names no profile is on Default, said as the launcher says it; one this computer lacks, by its id', async () => {
    const { rerender } = render(<ProfileOff profile={undefined} />)
    await screen.findByText('Default')
    rerender(<ProfileOff profile="elsewhere-made" />)
    expect(screen.getByText('elsewhere-made')).toBeTruthy()
  })
})

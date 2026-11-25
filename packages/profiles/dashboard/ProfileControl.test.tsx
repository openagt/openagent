import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult, type UiComposerControlProps } from '@openagt/ui/module'
import { GearMenu, fakeHost, gear, hoverTooltip, openSetupLine, renderWithHost, setupLine } from '@openagt/ui/module/testing'
import { ProfileControl } from './ProfileControl.js'

// The gear's Profile line, drawn in the shell's gear, its module's calls as a test answers them.

const DEFAULT = { id: 'default', name: 'Default', options: {} }
const REVIEWER = { id: 'reviewer', name: 'Reviewer', options: { skills: { project: 'none' } } }
let picked = 'default'
const callComputer = vi.fn(async (name: string, input: object): Promise<ModuleCallResult> => {
  if (name === 'profiles') return { ok: true, output: { profiles: [DEFAULT, REVIEWER], picked } }
  if (name === 'pickProfile') return (picked = (input as { id: string }).id), { ok: true, output: { ok: true } }
  return { ok: false, error: `no ${name} here` }
})
const host = fakeHost('@openagt/profiles', { callComputer })
const say = vi.fn()

function draw(props: Partial<UiComposerControlProps>) {
  const all: UiComposerControlProps = { in: 'launcher', projectId: 'p1', options: {}, onChange: () => {}, busy: false, say, ...props }
  return renderWithHost(<GearMenu lines={<ProfileControl {...all} />} />, host)
}

beforeEach(() => {
  picked = 'default'
})
afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  callComputer.mockClear()
  say.mockClear()
  host.openPage.mockClear()
})

describe("the launcher's Profile line", () => {
  test('the profile every next run is on, by name, said for the gear\'s hover; its list ticks it; another picked is saved for every next run and said back; "Manage profiles…" opens the page', async () => {
    draw({})
    expect((await setupLine('Profile')).textContent).toBe('Profile: Default')
    expect(say).toHaveBeenLastCalledWith({ words: 'Profile Default' })
    await openSetupLine('Profile')
    const row = (name: RegExp) => screen.getByRole('menuitem', { name })
    expect(row(/^Default/).querySelector('.lucide-check')!.classList.contains('opacity-100')).toBe(true)
    expect(row(/^Reviewer/).querySelector('.lucide-check')!.classList.contains('opacity-0')).toBe(true)
    fireEvent.click(row(/^Reviewer/))
    await waitFor(() => expect(callComputer).toHaveBeenCalledWith('pickProfile', { id: 'reviewer' }))
    await waitFor(async () => expect((await setupLine('Profile')).textContent).toBe('Profile: Reviewer'))
    expect(say).toHaveBeenLastCalledWith({ words: 'Profile Reviewer' })
    await openSetupLine('Profile')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage profiles…' }))
    expect(host.openPage).toHaveBeenCalledWith('profiles')
  })

  test('no line until the profiles are read', async () => {
    callComputer.mockImplementationOnce(() => new Promise(() => {}))
    draw({})
    fireEvent.click(gear())
    await waitFor(() => expect(gear().getAttribute('aria-expanded')).toBe('true'))
    expect(screen.queryAllByRole('menuitem')).toEqual([])
    expect(say).not.toHaveBeenCalledWith(expect.objectContaining({ words: expect.any(String) }))
  })
})

describe("a session's Profile line, said and not offered", () => {
  test('the profile its record names, by its name, a line that opens no list, with what its hover says', async () => {
    draw({ in: 'session', agentId: 'a1', options: { profiles: { profile: 'reviewer' } } })
    const line = await setupLine('Profile')
    expect(line.getAttribute('aria-haspopup')).toBeNull()
    expect(line.getAttribute('aria-disabled')).toBe('true')
    expect(line.textContent).toBe('Profile: Reviewer. This session is on the profile Reviewer: its accounts, and the project skills it gets')
    expect((await hoverTooltip(line)).textContent).toBe('This session is on the profile Reviewer: its accounts, and the project skills it gets')
    expect(screen.getByText('Reviewer').className.split(' ')).toContain('truncate')
  })

  test('a record that names no profile is on Default; one this computer lacks, by its id', async () => {
    const { rerender } = draw({ in: 'session', agentId: 'a1', options: {} })
    expect((await setupLine('Profile')).textContent).toMatch(/^Profile: Default\./)
    rerender(<GearMenu lines={<ProfileControl in="session" agentId="a1" options={{ profiles: { profile: 'elsewhere-made' } }} onChange={() => {}} busy={false} say={say} />} />)
    expect((await setupLine('Profile')).textContent).toMatch(/^Profile: elsewhere-made\./)
  })
})

test("in a profile's editor it draws nothing: a profile is on no profile", async () => {
  const { container } = renderWithHost(<ProfileControl in="profile" options={{}} onChange={() => {}} busy={false} say={say} />, host)
  expect(container.textContent).toBe('')
  expect(callComputer).not.toHaveBeenCalled()
})

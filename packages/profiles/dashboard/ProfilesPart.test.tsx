import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { ProfilesPart } from './ProfilesPart.js'

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
})

describe("the Overview line's part on the person's profiles", () => {
  test('how many agent profiles, by name on its hover, and their page a press away', async () => {
    const callComputer = vi.fn(async (): Promise<ModuleCallResult> => ({ ok: true, output: { profiles: [{ id: 'default', name: 'Default', options: {} }, { id: 'reviewer', name: 'Reviewer', options: {} }], picked: 'default' } }))
    const host = fakeHost('@openagt/profiles', { callComputer })
    renderWithHost(<ProfilesPart />, host)
    const part = await screen.findByRole('link', { name: '2 agent profiles' })
    expect(part.getAttribute('title')).toBe('Default, Reviewer')
    expect(part.getAttribute('href')).toBe('/profiles')
    fireEvent.click(part)
    expect(host.openPage).toHaveBeenCalledWith('profiles')
  })

  test('no count before the list is read', async () => {
    renderWithHost(<ProfilesPart />, fakeHost('@openagt/profiles', { callComputer: () => new Promise(() => {}) }))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Loading…')).toBeTruthy()
  })
})

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const onProfilesList = vi.hoisted(() => vi.fn())
vi.mock('../rpc/profiles.js', () => ({ onProfilesList }))
const openPage = vi.hoisted(() => vi.fn())
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, openPage } }
})

const { YourProfilesPart } = await import('./YourProfilesPart.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
})

describe('the Overview line\'s part on the person\'s profiles', () => {
  test('how many agent profiles, by name on its hover, and their page a press away', async () => {
    onProfilesList.mockResolvedValue({ profiles: [{ id: 'default', name: 'Default', options: {} }, { id: 'reviewer', name: 'Reviewer', options: {} }], claude: [], codex: [], plugins: [] })
    render(<YourProfilesPart />)
    const part = await screen.findByRole('link', { name: '2 agent profiles' })
    expect(part.getAttribute('title')).toBe('Default, Reviewer')
    expect(part.getAttribute('href')).toBe('/profiles')
    fireEvent.click(part)
    expect(openPage).toHaveBeenCalledWith('profiles')
  })

  test('no count before the list is read', async () => {
    onProfilesList.mockReturnValue(new Promise(() => {}))
    render(<YourProfilesPart />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Loading…')).toBeTruthy()
  })
})

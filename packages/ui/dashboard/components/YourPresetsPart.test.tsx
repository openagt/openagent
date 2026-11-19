import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const onPresetsList = vi.hoisted(() => vi.fn())
vi.mock('../rpc/presets.js', () => ({ onPresetsList }))
const openPage = vi.hoisted(() => vi.fn())
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, openPage } }
})

const { YourPresetsPart } = await import('./YourPresetsPart.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
})

describe('the Overview line\'s part on the person\'s presets', () => {
  test('how many presets, by name on its hover, and their page a press away', async () => {
    onPresetsList.mockResolvedValue({ presets: [{ id: 'default', name: 'Default', options: {} }, { id: 'reviewer', name: 'Reviewer', options: {} }], claude: [], codex: [] })
    render(<YourPresetsPart />)
    const part = await screen.findByRole('link', { name: '2 presets' })
    expect(part.getAttribute('title')).toBe('Default, Reviewer')
    expect(part.getAttribute('href')).toBe('/presets')
    fireEvent.click(part)
    expect(openPage).toHaveBeenCalledWith('presets')
  })

  test('no count before the list is read', async () => {
    onPresetsList.mockReturnValue(new Promise(() => {}))
    render(<YourPresetsPart />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Loading…')).toBeTruthy()
  })
})

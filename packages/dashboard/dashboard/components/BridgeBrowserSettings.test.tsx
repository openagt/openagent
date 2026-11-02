import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { BridgeBrowserStatus } from '../../src/bridge-browser.js'

const onBridgeBrowser = vi.hoisted(() => vi.fn(async (): Promise<BridgeBrowserStatus> => ({ state: 'off' })))
const sendBridgeBrowser = vi.hoisted(() => vi.fn(async (_action: 'show' | 'hide' | 'restart') => ({ ok: true })))
vi.mock('../rpc/reads.js', () => ({ onBridgeBrowser }))
vi.mock('../rpc/control.js', () => ({ sendBridgeBrowser }))

import { BridgeBrowserSettings } from './BridgeBrowserSettings.js'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BridgeBrowserSettings (#1332)', () => {
  test('a launch under way names its step, so a minutes-long download is not a hang', async () => {
    onBridgeBrowser.mockResolvedValue({ state: 'starting', detail: 'downloading Chrome for Testing 150: 42%' })
    render(<BridgeBrowserSettings enabled />)
    const line = await screen.findByText(/Starting the bridge browser/)
    expect(line.textContent).toContain('42%')
  })

  test('a running browser on the sign-in page asks for the one thing only a person can do', async () => {
    onBridgeBrowser.mockResolvedValue({ state: 'running', since: '2026-08-26T12:00:00.000Z', visible: false, signIn: true })
    render(<BridgeBrowserSettings enabled />)
    const button = await screen.findByText('Show the window to sign in')
    expect(screen.getByText(/sign in once/)).toBeTruthy()
    fireEvent.click(button)
    expect(sendBridgeBrowser).toHaveBeenCalledWith('show')
  })

  test('a shown window offers to hide it; a signed-in browser has no sign-in prompt', async () => {
    onBridgeBrowser.mockResolvedValue({ state: 'running', since: '2026-08-26T12:00:00.000Z', visible: true, signIn: false })
    render(<BridgeBrowserSettings enabled />)
    const hide = await screen.findByText('Hide the window')
    expect(screen.queryByText(/sign in once/)).toBeNull()
    fireEvent.click(hide)
    expect(sendBridgeBrowser).toHaveBeenCalledWith('hide')
  })

  test('a browser that stopped says why and offers a restart, because quitting it was an act', async () => {
    onBridgeBrowser.mockResolvedValue({ state: 'stopped', detail: 'Chrome exited on SIGTERM' })
    render(<BridgeBrowserSettings enabled />)
    const line = await screen.findByText(/The bridge browser is not running/)
    expect(line.textContent).toContain('Chrome exited on SIGTERM')
    fireEvent.click(screen.getByText('Restart'))
    expect(sendBridgeBrowser).toHaveBeenCalledWith('restart')
  })

  test('nothing is shown while the switch is off', () => {
    const { container } = render(<BridgeBrowserSettings enabled={false} />)
    expect(container.textContent).toBe('')
    expect(onBridgeBrowser).not.toHaveBeenCalled()
  })
})

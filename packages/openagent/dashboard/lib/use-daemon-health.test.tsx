import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

const onProjects = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onProjects }))

const { useDaemonHealth } = await import('./use-daemon-health.js')

/** Let the probe's clock run, and React apply what it answered. */
const after = (ms: number): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  onProjects.mockReset()
  vi.useRealTimers()
})

function Probe() {
  return <span>{useDaemonHealth() ? 'healthy' : 'down'}</span>
}

// #948: a dead daemon froze every surface silently — the probe is what lets the shell say so.
describe('useDaemonHealth', () => {
  test('an answering daemon reads healthy', async () => {
    onProjects.mockResolvedValue([])
    render(<Probe />)
    await after(5000)
    expect(onProjects).toHaveBeenCalled()
    expect(screen.getByText('healthy')).toBeTruthy()
  })

  test('a failing probe flips to down', async () => {
    onProjects.mockRejectedValue(new Error('ECONNREFUSED'))
    render(<Probe />)
    await after(5000)
    expect(screen.getByText('down')).toBeTruthy()
  })

  test('no probe as the page opens, which asks the daemon plenty then, and none while the tab is not shown', async () => {
    onProjects.mockResolvedValue([])
    render(<Probe />)
    await after(4999)
    expect(onProjects).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      await after(30_000)
      expect(onProjects).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    }
    await after(5000)
    expect(onProjects).toHaveBeenCalledTimes(1)
  })
})

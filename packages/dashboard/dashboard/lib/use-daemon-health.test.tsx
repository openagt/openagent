import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

const { useDaemonHealth } = await import('./use-daemon-health.js')

/** A probe's request as the daemon sees it: answered, failed, or left hanging; `deaf` hangs on even once the page aborts it. */
type Way = 'answer' | 'fail' | 'hang' | 'deaf'
type Asked = { signal: AbortSignal | null | undefined; settled: boolean; fail: () => void }
let asked: Asked[] = []
let ways: Way[] = []
let way: Way = 'answer'

/** The daemon's side of each request: the next of `ways`, else `way`. A request the page aborts fails, as a real one does. */
function daemon(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const one: Asked = {
      signal: init.signal,
      settled: false,
      fail: () => {
        one.settled = true
        reject(new TypeError('Failed to fetch'))
      },
    }
    asked.push(one)
    const it = ways.shift() ?? way
    if (it !== 'deaf') init.signal?.addEventListener('abort', () => one.fail())
    if (it === 'answer') {
      one.settled = true
      resolve(new Response(JSON.stringify({ ret: [] })))
    } else if (it === 'fail') one.fail()
  })
}
const pending = (): number => asked.filter(one => !one.settled).length

/** Let the probe's clock run, and React apply what it answered. */
const after = (ms: number): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(daemon))
  asked = []
  ways = []
  way = 'answer'
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function Probe() {
  return <span>{useDaemonHealth()}</span>
}

// #948: a dead daemon froze every surface silently — the probe is what lets the shell say so.
describe('useDaemonHealth', () => {
  test('an answering daemon reads answering', async () => {
    render(<Probe />)
    await after(5000)
    expect(asked).toHaveLength(1)
    expect(screen.getByText('answering')).toBeTruthy()
  })

  test('a probe refused at once reads stopped once a second try a second later is refused too; offline, it reads only silent', async () => {
    way = 'fail'
    render(<Probe />)
    await after(5000)
    expect(screen.getByText('answering')).toBeTruthy()
    await after(1000)
    expect(asked).toHaveLength(2)
    expect(screen.getByText('stopped')).toBeTruthy()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await after(5000)
    expect(screen.getByText('silent')).toBeTruthy()
  })

  test('one refused probe that the second try answers never reads stopped', async () => {
    ways = ['fail']
    render(<Probe />)
    await after(5000 + 1000)
    expect(asked).toHaveLength(2)
    expect(screen.getByText('answering')).toBeTruthy()
  })

  test('a probe the daemon takes but does not answer counts as not answered after its time limit, which lets its request go; the next answer brings it back', async () => {
    ways = ['hang']
    render(<Probe />)
    await after(5000 + 29_999)
    expect(screen.getByText('answering')).toBeTruthy()
    await after(1)
    expect(screen.getByText('silent')).toBeTruthy()
    expect(asked[0]!.signal?.aborted).toBe(true)
    await after(5000)
    expect(screen.getByText('answering')).toBeTruthy()
    expect(asked).toHaveLength(2)
    await after(5000)
    expect(asked).toHaveLength(3)
  })

  test('a probe given up on that fails after a newer one answered changes nothing: the page stays answering', async () => {
    ways = ['deaf']
    render(<Probe />)
    await after(5000 + 30_000)
    expect(screen.getByText('silent')).toBeTruthy()
    await after(5000)
    expect(screen.getByText('answering')).toBeTruthy()
    asked[0]!.fail()
    await after(0)
    expect(screen.getByText('answering')).toBeTruthy()
  })

  test('a probe given up on that fails while a newer one waits changes nothing: no probe starts early, and the newer one keeps its own time limit', async () => {
    ways = ['deaf', 'hang']
    render(<Probe />)
    await after(5000 + 30_000 + 5000)
    expect(asked).toHaveLength(2)
    asked[0]!.fail()
    await after(5000)
    expect(asked).toHaveLength(2)
    expect(asked[1]!.signal?.aborted).toBe(false)
    await after(30_000 - 5000 - 1)
    expect(asked[1]!.signal?.aborted).toBe(false)
    await after(1)
    expect(asked[1]!.signal?.aborted).toBe(true)
    expect(asked).toHaveLength(2)
  })

  test('while the daemon answers nothing, one probe request is pending at a time: each one given up on is aborted', async () => {
    way = 'hang'
    render(<Probe />)
    await after(215_000)
    expect(screen.getByText('silent')).toBeTruthy()
    expect(asked.length).toBeGreaterThanOrEqual(6)
    expect(pending()).toBe(1)
    expect(asked.slice(0, -1).every(one => one.signal?.aborted)).toBe(true)
  })

  test('leaving the page aborts the probe in flight', async () => {
    way = 'hang'
    const { unmount } = render(<Probe />)
    await after(5000)
    expect(pending()).toBe(1)
    unmount()
    expect(asked[0]!.signal?.aborted).toBe(true)
    expect(pending()).toBe(0)
  })

  test('no probe as the page opens, which asks the daemon plenty then, and none while the tab is not shown', async () => {
    render(<Probe />)
    await after(4999)
    expect(asked).toHaveLength(0)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      await after(30_000)
      expect(asked).toHaveLength(0)
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    }
    await after(5000)
    expect(asked).toHaveLength(1)
  })
})

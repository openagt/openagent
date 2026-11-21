import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { QuotaView } from '../../src/index.js'

// The read is a fetch over the wire, so stub it: these tests are about the hook's own
// behavior (poll, keep-last-on-failure, stop on unmount), not the daemon.
const onQuota = vi.hoisted(() => vi.fn())
vi.mock('../rpc/quota.js', () => ({ onQuota }))

const { useQuota } = await import('./quota.js')

/** A reading the hook should pass straight through; `percentUsed` just tells them apart. */
const view = (percentUsed: number): QuotaView => ({
  windows: [{ label: 'Current session', kind: 'session', percentUsed }],
})

/** Let queued RPCs settle and React apply the state they resolved with. */
const settle = (ms = 0): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('useQuota', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    onQuota.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('is undefined until the first answer arrives, then reports it', async () => {
    onQuota.mockResolvedValue(view(10))
    const { result } = renderHook(() => useQuota())
    expect(result.current).toBeUndefined() // nothing to show yet, not "nothing used"
    await settle()
    expect(result.current).toEqual(view(10))
  })

  test('refreshes on its interval', async () => {
    onQuota.mockResolvedValue(view(10))
    const { result } = renderHook(() => useQuota())
    await settle()

    onQuota.mockResolvedValue(view(55))
    await settle(30_000)
    expect(result.current).toEqual(view(55))
  })

  test('a failed refresh keeps the last view rather than blanking it', async () => {
    onQuota.mockResolvedValue(view(42))
    const { result } = renderHook(() => useQuota())
    await settle()

    onQuota.mockRejectedValue(new Error('daemon restarted'))
    await settle(30_000)
    expect(result.current).toEqual(view(42)) // an empty bar would read as "nothing used"
  })

  test('stops polling once unmounted', async () => {
    onQuota.mockResolvedValue(view(10))
    const { unmount } = renderHook(() => useQuota())
    await settle()
    expect(onQuota).toHaveBeenCalledTimes(1)

    unmount()
    await settle(90_000)
    expect(onQuota).toHaveBeenCalledTimes(1) // no ticks after teardown
  })
})

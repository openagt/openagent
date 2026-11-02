import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/** The page's one stream to the daemon, as a test drives it. */
class FakeStream {
  static made: FakeStream[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeStream.made.push(this)
  }
  close(): void {
    this.closed = true
  }
  open(): void {
    act(() => this.onopen?.())
  }
  tell(projectId: string): void {
    act(() => this.onmessage?.({ data: JSON.stringify({ kind: 'runs', projectId }) }))
  }
}

beforeEach(() => {
  FakeStream.made = []
  vi.stubGlobal('EventSource', FakeStream)
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())

test("a read of one project's runs is told of that project's changes, and of every project's when the stream opened again", async () => {
  const { onRunsChanged } = await import('./runs-changed.js')
  const shop: number[] = []
  const any: number[] = []
  const stopShop = onRunsChanged('shop', change => shop.push(change))
  const stopAny = onRunsChanged(undefined, change => any.push(change))
  // One stream for the page, however many read.
  expect(FakeStream.made.map(stream => stream.url)).toEqual(['/_rpc/changes'])
  const stream = FakeStream.made[0]!
  stream.open()
  expect([shop, any]).toEqual([[], []])
  stream.tell('blog')
  stream.tell('shop')
  // One number per change, the same to each read told of it.
  expect(shop).toEqual([2])
  expect(any).toEqual([1, 2])
  // It dropped and opened again: what changed meanwhile is read by all.
  act(() => stream.onerror?.())
  stream.open()
  expect(shop).toEqual([2, 3])
  stopShop()
  stopAny()
  // Nobody reads: the stream is let go.
  expect(stream.closed).toBe(true)
})

test('a read of the runs polls slowly only while the daemon tells of every change', async () => {
  const { onRunsChanged, useRunsPace, TOLD_EVERY_MS } = await import('./runs-changed.js')
  const { result } = renderHook(() => useRunsPace(2000))
  expect(result.current).toBe(2000)
  const stop = onRunsChanged('shop', () => {})
  FakeStream.made[0]!.open()
  expect(result.current).toBe(TOLD_EVERY_MS)
  act(() => FakeStream.made[0]!.onerror?.())
  expect(result.current).toBe(2000)
  stop()
})

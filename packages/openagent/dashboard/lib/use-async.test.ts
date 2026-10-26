import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { StaleReads, forgetRemembered, readAhead, useLoaded, usePolled } from './use-async.js'

/** Let queued reads settle and React apply the state they resolved with. */
const settle = (ms = 0): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useLoaded', () => {
  test('holds the initial value until the answer arrives, then reports it', async () => {
    const load = vi.fn().mockResolvedValue('answer')
    const { result } = renderHook(() => useLoaded(load, 'initial', []))
    expect(result.current).toBe('initial')
    await settle()
    expect(result.current).toBe('answer')
  })

  test('does not read at all when there is nothing to read yet', async () => {
    const { result } = renderHook(() => useLoaded<string[]>(null, [], [undefined]))
    await settle()
    expect(result.current).toEqual([])
  })

  test('re-reads when deps change, and resets rather than showing the last dep-s value', async () => {
    const load = vi.fn((id: string) => Promise.resolve(`data-${id}`))
    const { result, rerender } = renderHook(({ id }) => useLoaded(() => load(id), 'initial', [id]), {
      initialProps: { id: 'a' },
    })
    await settle()
    expect(result.current).toBe('data-a')

    rerender({ id: 'b' })
    expect(result.current).toBe('initial') // not 'data-a': b's panel must not show a's data
    await settle()
    expect(result.current).toBe('data-b')
  })

  test('a read that lands after its deps changed is dropped', async () => {
    let resolveA: (v: string) => void = () => {}
    const load = vi.fn((id: string) =>
      id === 'a' ? new Promise<string>(r => (resolveA = r)) : Promise.resolve(`data-${id}`),
    )
    const { result, rerender } = renderHook(({ id }) => useLoaded(() => load(id), 'initial', [id]), {
      initialProps: { id: 'a' },
    })
    rerender({ id: 'b' })
    await settle()
    expect(result.current).toBe('data-b')

    resolveA('data-a') // a's read finally lands, but a is not what is on screen
    await settle()
    expect(result.current).toBe('data-b')
  })

  test('a rejected read keeps the last value rather than blanking it', async () => {
    const load = vi.fn().mockResolvedValue('answer')
    const { result } = renderHook(() => useLoaded(load, 'initial', []))
    await settle()

    load.mockRejectedValue(new Error('daemon restarted'))
    await settle()
    expect(result.current).toBe('answer') // and no unhandled rejection: vitest fails the run on one
  })
})

describe('usePolled', () => {
  test('re-reads on its interval', async () => {
    const load = vi.fn().mockResolvedValue(1)
    const { result } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()
    expect(result.current.value).toBe(1)

    load.mockResolvedValue(2)
    await settle(5000)
    expect(result.current.value).toBe(2)
  })

  test('stops polling once unmounted', async () => {
    const load = vi.fn().mockResolvedValue(1)
    const { unmount } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()
    expect(load).toHaveBeenCalledTimes(1)

    unmount()
    await settle(50_000)
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('a rejected read keeps the last value and polling survives it', async () => {
    const load = vi.fn().mockResolvedValue(1)
    const { result } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()

    load.mockRejectedValue(new Error('daemon restarted'))
    await settle(5000)
    expect(result.current.value).toBe(1) // kept, not blanked

    load.mockResolvedValue(3)
    await settle(5000)
    expect(result.current.value).toBe(3) // the next tick recovers
  })

  test('reload reads immediately, without waiting for the next tick', async () => {
    const load = vi.fn().mockResolvedValue(1)
    const { result } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()

    load.mockResolvedValue(2)
    await act(async () => result.current.reload())
    expect(result.current.value).toBe(2)
  })

  test('reload cannot write back after unmount', async () => {
    let resolveLate: (v: number) => void = () => {}
    const load = vi.fn().mockResolvedValue(1)
    const { result, unmount } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()

    load.mockReturnValue(new Promise<number>(r => (resolveLate = r)))
    const { reload } = result.current
    reload()
    unmount()
    resolveLate(99) // the in-flight reload lands after teardown
    await settle()
    expect(result.current.value).toBe(1) // never applied
  })

  test('does not poll when there is nothing to read yet', async () => {
    const { result } = renderHook(() => usePolled<string[]>(null, [], 5000, [undefined]))
    await settle(20_000)
    expect(result.current.value).toEqual([])
  })
})

describe('remembering answers per key', () => {
  test('going back to a target shows its last answer at once, marked loaded, and reads it again', async () => {
    let round = 0
    const load = vi.fn((id: string) => Promise.resolve(`${id}-${++round}`))
    const { result, rerender } = renderHook(
      ({ id }) => usePolled(() => load(id), 'initial', 60_000, [id], { remember: `thing:${id}` }),
      { initialProps: { id: 'a' } },
    )
    await settle()
    expect(result.current).toMatchObject({ value: 'a-1', loaded: true })

    rerender({ id: 'b' })
    // Never seen: nothing, and never a's answer.
    expect(result.current).toMatchObject({ value: 'initial', loaded: false })
    await settle()
    expect(result.current.value).toBe('b-2')

    rerender({ id: 'a' })
    // Seen before: a's last answer from the first frame, while it is read again.
    expect(result.current).toMatchObject({ value: 'a-1', loaded: true })
    await settle()
    expect(result.current.value).toBe('a-3')
    expect(load).toHaveBeenCalledTimes(3)
  })

  test('no frame after a switch shows the last target\'s answer, not even the first one', async () => {
    const frames: string[] = []
    const { rerender } = renderHook(
      ({ id }) => {
        const { value } = usePolled(() => Promise.resolve(`data-${id}`), 'initial', 60_000, [id], { remember: `thing:${id}` })
        frames.push(`${id}:${value}`)
        return value
      },
      { initialProps: { id: 'a' } },
    )
    await settle()
    rerender({ id: 'b' })
    await settle()
    rerender({ id: 'a' })
    await settle()
    expect(frames.filter(f => f.startsWith('b:')).every(f => f === 'b:initial' || f === 'b:data-b')).toBe(true)
    expect(frames.filter(f => f.startsWith('a:')).slice(-3).every(f => f === 'a:data-a')).toBe(true)
  })

  test('with nothing to read, nothing remembered is shown', async () => {
    const { result, rerender } = renderHook(
      ({ on }) => useLoaded(on ? () => Promise.resolve('answer') : null, 'initial', [on], { remember: 'thing' }),
      { initialProps: { on: true } },
    )
    await settle()
    expect(result.current).toBe('answer')
    rerender({ on: false })
    expect(result.current).toBe('initial')
  })

  test("'previous' keeps the last answer across a switch", async () => {
    const { result, rerender } = renderHook(
      ({ id }) => useLoaded(() => new Promise<string>(resolve => (id === 'a' ? resolve('data-a') : undefined)), 'initial', [id], 'previous'),
      { initialProps: { id: 'a' } },
    )
    await settle()
    rerender({ id: 'b' })
    expect(result.current).toBe('data-a')
  })
})

describe('reading an answer ahead of its page', () => {
  beforeEach(() => forgetRemembered())

  test('a page opened after the read shows the answer in its first frame, and reads it again', async () => {
    readAhead('thing:a', () => Promise.resolve('ahead'))
    await settle()
    const frames: string[] = []
    const { result } = renderHook(() => {
      const read = usePolled(() => Promise.resolve('fresh'), 'initial', 60_000, ['a'], { remember: 'thing:a' })
      frames.push(`${read.value}:${read.loaded}`)
      return read
    })
    expect(frames[0]).toBe('ahead:true')
    await settle()
    expect(result.current.value).toBe('fresh')
    expect(frames).not.toContain('initial:false')
  })

  test('a key is asked for once while its read is out, and never once it holds an answer', async () => {
    const load = vi.fn(() => Promise.resolve('ahead'))
    readAhead('thing:a', load)
    readAhead('thing:a', load)
    await settle()
    readAhead('thing:a', load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('a read ahead that fails keeps nothing, and the next one asks again', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('down')).mockResolvedValue('ahead')
    readAhead('thing:a', load)
    await settle()
    const { result } = renderHook(() => useLoaded<string>(null, 'initial', ['a'], { remember: 'thing:a' }))
    expect(result.current).toBe('initial')
    readAhead('thing:a', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('an answer the page read meanwhile is not replaced by the older one read ahead', async () => {
    let answer!: (value: string) => void
    readAhead('thing:a', () => new Promise<string>(resolve => (answer = resolve)))
    const { result, unmount } = renderHook(() => useLoaded(() => Promise.resolve('fresh'), 'initial', ['a'], { remember: 'thing:a' }))
    await settle()
    expect(result.current).toBe('fresh')
    unmount()
    answer('ahead')
    await settle()
    const again = renderHook(() => usePolled(() => new Promise<string>(() => {}), 'initial', 60_000, ['a'], { remember: 'thing:a' }))
    expect(again.result.current.value).toBe('fresh')
  })
})

describe('asking no more than needed', () => {
  beforeEach(() => forgetRemembered())

  /** Set what the page's tab says of itself, and tell the page. */
  const tabShown = (shown: boolean): void => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (shown ? 'visible' : 'hidden') })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  afterEach(() => tabShown(true))

  test('a poll never asks again while its answer is on its way, and asks the next time from when it answered', async () => {
    let answer!: (value: number) => void
    const load = vi.fn(() => new Promise<number>(resolve => (answer = resolve)))
    const { result } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle(20_000)
    expect(load).toHaveBeenCalledTimes(1) // a slow server: no pile of the same question behind it
    answer(1)
    await settle()
    expect(result.current.value).toBe(1)
    await settle(4999)
    expect(load).toHaveBeenCalledTimes(1)
    await settle(1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('a tab not shown reads nothing, and reads at once when it is shown again', async () => {
    const load = vi.fn().mockResolvedValue(1)
    renderHook(() => usePolled(load, 0, 5000, []))
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    tabShown(false)
    await settle(60_000)
    expect(load).toHaveBeenCalledTimes(1)
    act(() => tabShown(true))
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
    await settle(5000)
    expect(load).toHaveBeenCalledTimes(3) // and polls on
  })

  test('two parts asking under one key wait for one read, and each answer reaches both', async () => {
    let round = 0
    const load = vi.fn(() => Promise.resolve(++round))
    const tile = renderHook(() => usePolled(load, 0, 10_000, [], { remember: 'queue:p1' }))
    const card = renderHook(() => usePolled(load, 0, 10_000, [], { remember: 'queue:p1' }))
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    expect([tile.result.current.value, card.result.current.value]).toEqual([1, 1])
    await settle(10_000)
    expect(load).toHaveBeenCalledTimes(2)
    expect([tile.result.current.value, card.result.current.value]).toEqual([2, 2])
  })

  test('reload asks anew even while a read is out, and the older answer landing after it is dropped', async () => {
    const answers: ((value: string) => void)[] = []
    const load = vi.fn(() => new Promise<string>(resolve => answers.push(resolve)))
    const { result } = renderHook(() => usePolled(load, 'initial', 5000, []))
    await settle()
    void result.current.reload()
    expect(load).toHaveBeenCalledTimes(2) // asked after a change the first read may not hold
    answers[1]!('after the change')
    await settle()
    answers[0]!('before the change')
    await settle()
    expect(result.current.value).toBe('after the change')
  })

  test('new deps under the same key ask anew rather than wait for the read asked before the change', async () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const { rerender } = renderHook(({ tick }) => usePolled(load, 'initial', 30_000, [tick], { remember: 'projects' }), { initialProps: { tick: 0 } })
    await settle()
    rerender({ tick: 1 })
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('a poll that changes its pace', () => {
  test('keeps what it shows and reads at the new pace from then on', async () => {
    let round = 0
    const load = vi.fn(() => Promise.resolve(++round))
    const { result, rerender } = renderHook(({ every }) => usePolled(load, 0, every, ['p1']), { initialProps: { every: 10_000 } })
    await settle()
    expect(result.current.value).toBe(1)
    rerender({ every: 2000 })
    expect(result.current).toMatchObject({ value: 1, loaded: true }) // the rail does not blank
    expect(load).toHaveBeenCalledTimes(1)
    await settle(2000)
    expect(load).toHaveBeenCalledTimes(2)
    await settle(2000)
    expect(load).toHaveBeenCalledTimes(3)
  })
})

describe('an answer stored for the next visit', () => {
  beforeEach(() => {
    forgetRemembered()
    localStorage.clear()
  })

  /** A new page: nothing in its memory, what the browser stored still there. */
  const reopen = (): void => forgetRemembered()

  test('a page opened again shows the stored answer from its first frame, stale, until the fresh one lands', async () => {
    const first = renderHook(() => usePolled(() => Promise.resolve(3), 0, 10_000, [], { remember: 'queue:p1', stored: true }))
    await settle()
    expect(first.result.current).toMatchObject({ value: 3, stale: false })
    first.unmount()
    reopen()

    let answer!: (value: number) => void
    const frames: string[] = []
    const { result } = renderHook(() => {
      const read = usePolled(() => new Promise<number>(resolve => (answer = resolve)), 0, 10_000, [], { remember: 'queue:p1', stored: true })
      frames.push(`${read.value}:${read.loaded}:${read.stale}`)
      return read
    })
    expect(frames[0]).toBe('3:true:true')
    await settle()
    expect(result.current.stale).toBe(true)
    answer(4)
    await settle()
    expect(result.current).toMatchObject({ value: 4, loaded: true, stale: false })
  })

  test('only a read that asks for it is stored', async () => {
    const plain = renderHook(() => usePolled(() => Promise.resolve(3), 0, 10_000, [], { remember: 'plain' }))
    await settle()
    plain.unmount()
    reopen()
    const { result } = renderHook(() => usePolled(() => new Promise<number>(() => {}), 0, 10_000, [], { remember: 'plain', stored: true }))
    expect(result.current).toMatchObject({ value: 0, loaded: false, stale: false })
  })

  test('the part of the page around a stale read is told, and told again when it is fresh', async () => {
    localStorage.setItem('openagent:read:queue:p1', '3')
    const told: boolean[] = []
    let answer!: (value: number) => void
    function Card() {
      const { value } = usePolled(() => new Promise<number>(resolve => (answer = resolve)), 0, 10_000, [], { remember: 'queue:p1', stored: true })
      return createElement('span', null, value)
    }
    const around = (children: ReactNode) => createElement(StaleReads.Provider, { value: (_reader: object, stale: boolean) => void told.push(stale) }, children)
    const { container } = render(around(createElement(Card)))
    await settle()
    expect(container.textContent).toBe('3')
    expect(told.at(-1)).toBe(true)
    answer(5)
    await settle()
    expect(container.textContent).toBe('5')
    expect(told.at(-1)).toBe(false)
  })
})

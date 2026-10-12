import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

const sendStart = vi.hoisted(() => vi.fn())
const sendProjectToMachine = vi.hoisted(() => vi.fn())
const onProjectOnMachine = vi.hoisted(() => vi.fn())
vi.mock('../rpc/control.js', () => ({ sendStart }))
vi.mock('../rpc/machines.js', () => ({ sendProjectToMachine, onProjectOnMachine }))

import { CLONE_ASKED_EVERY_MS, useStartAgent } from './use-start-agent.js'

const NOT_THERE = { ok: false, error: 'shop is not on Studio yet.', notThere: true }
const ON_STUDIO = { machine: 'studio' }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  for (const mock of [sendStart, sendProjectToMachine, onProjectOnMachine]) mock.mockReset()
})

/** Let what is waited for land, and the page draw it. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)))
const nextAsk = () => act(async () => void (await vi.advanceTimersByTimeAsync(CLONE_ASKED_EVERY_MS)))

describe('useStartAgent', () => {
  test('a start that answers a run is one call, and clones nothing', async () => {
    sendStart.mockResolvedValue({ ok: true, agentId: 'r1' })
    const { result } = renderHook(() => useStartAgent())
    let started: unknown
    await act(async () => void (started = await result.current.start('p1', 'go', ON_STUDIO)))
    expect(started).toEqual({ ok: true, agentId: 'r1' })
    expect(sendStart).toHaveBeenCalledTimes(1)
    expect(sendProjectToMachine).not.toHaveBeenCalled()
    expect(result.current.cloning).toBe(false)
  })

  test('a machine that does not have the project clones it: the start waits, says it is cloning, asks until the project is there, and starts again', async () => {
    sendStart.mockResolvedValueOnce(NOT_THERE).mockResolvedValueOnce({ ok: true, agentId: 'r2' })
    sendProjectToMachine.mockResolvedValue({ ok: true, there: false })
    onProjectOnMachine.mockResolvedValueOnce({ ok: true, there: false }).mockResolvedValueOnce({ ok: true, there: true })
    const { result } = renderHook(() => useStartAgent())
    let started: unknown = 'not yet'
    act(() => void result.current.start('p1', 'go', ON_STUDIO).then(value => (started = value)))
    await settle()
    expect(sendProjectToMachine).toHaveBeenCalledWith('p1', 'studio')
    expect(result.current.cloning).toBe(true)
    expect(result.current.busy).toBe(true)
    expect(result.current.error).toBeNull() // the first refusal is not shown: it is being mended

    await nextAsk()
    expect(onProjectOnMachine).toHaveBeenCalledTimes(1)
    expect(result.current.cloning).toBe(true)
    expect(sendStart).toHaveBeenCalledTimes(1)

    await nextAsk()
    expect(onProjectOnMachine).toHaveBeenCalledTimes(2)
    expect(sendStart).toHaveBeenCalledTimes(2)
    expect(sendStart).toHaveBeenLastCalledWith('p1', 'go', ON_STUDIO)
    expect(started).toEqual({ ok: true, agentId: 'r2' })
    expect(result.current.cloning).toBe(false)
    expect(result.current.busy).toBe(false)
  })

  test('a project that was there by the time it was asked for starts at once', async () => {
    sendStart.mockResolvedValueOnce(NOT_THERE).mockResolvedValueOnce({ ok: true, agentId: 'r3' })
    sendProjectToMachine.mockResolvedValue({ ok: true, there: true })
    const { result } = renderHook(() => useStartAgent())
    let started: unknown
    await act(async () => void (started = await result.current.start('p1', 'go', ON_STUDIO)))
    expect(started).toEqual({ ok: true, agentId: 'r3' })
    expect(onProjectOnMachine).not.toHaveBeenCalled()
  })

  test('a clone that fails is the error shown, in the machine\'s words, and nothing starts', async () => {
    sendStart.mockResolvedValue(NOT_THERE)
    sendProjectToMachine.mockResolvedValue({ ok: true, there: false })
    onProjectOnMachine.mockResolvedValue({ ok: false, error: 'shop could not be cloned on Studio. Studio says: no login.' })
    const { result } = renderHook(() => useStartAgent())
    let started: unknown = 'not yet'
    act(() => void result.current.start('p1', 'go', ON_STUDIO).then(value => (started = value)))
    await settle()
    await nextAsk()
    expect(started).toBeUndefined()
    expect(result.current.error).toBe('shop could not be cloned on Studio. Studio says: no login.')
    expect(result.current.cloning).toBe(false)
    expect(sendStart).toHaveBeenCalledTimes(1)
  })

  test('any other refusal is shown as it is, and a start that named no machine clones nothing', async () => {
    sendStart.mockResolvedValue({ ok: false, error: 'the start hook: claude is not logged in' })
    const { result } = renderHook(() => useStartAgent())
    await act(async () => void (await result.current.start('p1', 'go', ON_STUDIO)))
    expect(result.current.error).toBe('the start hook: claude is not logged in')
    sendStart.mockResolvedValue(NOT_THERE)
    await act(async () => void (await result.current.start('p1', 'go')))
    expect(result.current.error).toBe('shop is not on Studio yet.')
    expect(sendProjectToMachine).not.toHaveBeenCalled()
  })

  test('a person who goes to another project\'s launcher while the machine clones started nothing, and is told nothing there', async () => {
    sendStart.mockResolvedValue(NOT_THERE)
    sendProjectToMachine.mockResolvedValue({ ok: true, there: false })
    onProjectOnMachine.mockResolvedValue({ ok: true, there: true })
    const { result, rerender } = renderHook(({ scope }) => useStartAgent(scope), { initialProps: { scope: 'p1' } })
    let started: unknown = 'not yet'
    act(() => void result.current.start('p1', 'go', ON_STUDIO).then(value => (started = value)))
    await settle()
    expect(result.current.cloning).toBe(true)
    rerender({ scope: 'p2' })
    expect(result.current.cloning).toBe(false) // the other project is not what is being cloned
    await nextAsk()
    expect(started).toBeUndefined()
    expect(result.current.error).toBeNull()
    expect(result.current.busy).toBe(false)
    expect(onProjectOnMachine).not.toHaveBeenCalled()
    expect(sendStart).toHaveBeenCalledTimes(1)
  })

  test('left while the last answer was on its way: the project is there, and still nothing starts', async () => {
    sendStart.mockResolvedValue(NOT_THERE)
    let answer!: (said: { ok: true; there: boolean }) => void
    sendProjectToMachine.mockReturnValue(new Promise(resolve => (answer = resolve)))
    const { result, unmount } = renderHook(() => useStartAgent('p1'))
    let started: unknown = 'not yet'
    act(() => void result.current.start('p1', 'go', ON_STUDIO).then(value => (started = value)))
    await settle()
    unmount()
    answer({ ok: true, there: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toBeUndefined()
    expect(sendStart).toHaveBeenCalledTimes(1)
  })

  test('a person who leaves the page while the machine clones started nothing', async () => {
    sendStart.mockResolvedValue(NOT_THERE)
    sendProjectToMachine.mockResolvedValue({ ok: true, there: false })
    onProjectOnMachine.mockResolvedValue({ ok: true, there: true })
    const { result, unmount } = renderHook(() => useStartAgent())
    let started: unknown = 'not yet'
    act(() => void result.current.start('p1', 'go', ON_STUDIO).then(value => (started = value)))
    await settle()
    unmount()
    await vi.advanceTimersByTimeAsync(CLONE_ASKED_EVERY_MS * 3)
    expect(started).toBeUndefined()
    expect(onProjectOnMachine).not.toHaveBeenCalled()
    expect(sendStart).toHaveBeenCalledTimes(1)
  })
})

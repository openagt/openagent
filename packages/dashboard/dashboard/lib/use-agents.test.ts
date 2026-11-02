import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { AgentMeta } from '../../src/index.js'

const onAgents = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onAgents }))

const { useAgents } = await import('./use-agents.js')

const agents = (id: string): AgentMeta[] => [{ id, status: 'done' } as AgentMeta]
const settle = (ms = 0): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('useAgents', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    onAgents.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  test('reads nothing until a project is selected', async () => {
    const { result } = renderHook(() => useAgents(null))
    await settle(10_000)
    expect(onAgents).not.toHaveBeenCalled()
    expect(result.current.agents).toEqual([])
  })

  test('polls the selected project every 2s', async () => {
    onAgents.mockResolvedValue(agents('a1'))
    const { result } = renderHook(() => useAgents('a'))
    await settle()
    expect(result.current.agents).toEqual(agents('a1'))

    onAgents.mockResolvedValue(agents('a2'))
    await settle(2000)
    expect(result.current.agents).toEqual(agents('a2'))
  })

  test('reload shows a just-started run without waiting for the next tick', async () => {
    onAgents.mockResolvedValue(agents('a1'))
    const { result } = renderHook(() => useAgents('a'))
    await settle()

    onAgents.mockResolvedValue(agents('a2'))
    await act(async () => result.current.reload())
    expect(result.current.agents).toEqual(agents('a2'))
  })

  test('a reload in flight during a project switch cannot write the old project s runs', async () => {
    let resolveA: (v: AgentMeta[]) => void = () => {}
    onAgents.mockResolvedValue(agents('a1'))
    const { result, rerender } = renderHook(({ id }) => useAgents(id), { initialProps: { id: 'a' } })
    await settle()

    onAgents.mockReturnValue(new Promise<AgentMeta[]>(r => (resolveA = r)))
    result.current.reload() // in flight against project a
    onAgents.mockResolvedValue(agents('b1'))
    rerender({ id: 'b' })
    await settle()
    expect(result.current.agents).toEqual(agents('b1'))

    resolveA(agents('a-late')) // a's reload lands after the switch
    await settle()
    expect(result.current.agents).toEqual(agents('b1')) // b's rail never shows a's runs
  })

  test('switching project clears the previous project s runs rather than showing them', async () => {
    onAgents.mockResolvedValue(agents('a1'))
    const { result, rerender } = renderHook(({ id }) => useAgents(id), { initialProps: { id: 'a' } })
    await settle()
    expect(result.current.agents).toEqual(agents('a1'))

    let resolveB: (v: AgentMeta[]) => void = () => {}
    onAgents.mockReturnValue(new Promise<AgentMeta[]>(r => (resolveB = r)))
    rerender({ id: 'b' })
    expect(result.current.agents).toEqual([]) // not a's runs, while b is still loading

    await act(async () => resolveB(agents('b1')))
    expect(result.current.agents).toEqual(agents('b1'))
  })

  test('a failed read keeps the last runs rather than emptying the rail', async () => {
    onAgents.mockResolvedValue(agents('a1'))
    const { result } = renderHook(() => useAgents('a'))
    await settle()

    onAgents.mockRejectedValue(new Error('daemon restarted'))
    await settle(2000)
    expect(result.current.agents).toEqual(agents('a1')) // and no unhandled rejection
  })

  test('an agent just started is read every 400ms until its card names its branch, then every 2s again', async () => {
    onAgents.mockResolvedValue([])
    renderHook(() => useAgents('a', 'new'))
    await settle()
    expect(onAgents).toHaveBeenCalledTimes(1)
    // Not in the list yet.
    await settle(400)
    expect(onAgents).toHaveBeenCalledTimes(2)
    // Its card is there, with no branch: its checkout is being made.
    onAgents.mockResolvedValue([{ id: 'new', status: 'running' } as AgentMeta])
    await settle(400)
    await settle(400)
    expect(onAgents).toHaveBeenCalledTimes(4)
    // The card names the branch: set up.
    onAgents.mockResolvedValue([{ id: 'new', status: 'running', branch: 'agent-new' } as AgentMeta])
    await settle(400)
    const read = onAgents.mock.calls.length
    await settle(1200)
    expect(onAgents.mock.calls.length - read).toBeLessThanOrEqual(1)
  })

  test('an agent just started is read every 400ms until its name has come too, then every 2s again', async () => {
    const startedAt = new Date().toISOString()
    onAgents.mockResolvedValue([{ id: 'new', status: 'running', branch: 'agent-new', startedAt } as AgentMeta])
    renderHook(() => useAgents('a', 'new'))
    await settle()
    // Set up, but no name yet: the name is what the person waits on now.
    await settle(400)
    await settle(400)
    expect(onAgents).toHaveBeenCalledTimes(3)
    onAgents.mockResolvedValue([{ id: 'new', status: 'running', branch: 'agent-new', startedAt, title: 'Readme condensing' } as AgentMeta])
    await settle(400)
    const read = onAgents.mock.calls.length
    await settle(1200)
    expect(onAgents.mock.calls.length - read).toBeLessThanOrEqual(1)
  })

  test('an agent that ended without a branch is not read more often', async () => {
    onAgents.mockResolvedValue([{ id: 'new', status: 'failed' } as AgentMeta])
    renderHook(() => useAgents('a', 'new'))
    await settle()
    await settle(1900)
    expect(onAgents).toHaveBeenCalledTimes(1)
  })

  test('the quicker reads stop after 30s for an agent that never names a branch', async () => {
    onAgents.mockResolvedValue([{ id: 'new', status: 'running' } as AgentMeta])
    renderHook(() => useAgents('a', 'new'))
    await settle(30_000)
    const read = onAgents.mock.calls.length
    await settle(4000)
    expect(onAgents.mock.calls.length - read).toBe(2)
  })

  test('with no agent just started, nothing is read more often', async () => {
    onAgents.mockResolvedValue([])
    renderHook(() => useAgents('a'))
    await settle()
    await settle(1900)
    expect(onAgents).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ModuleAgent } from '../../src/dashboard/module-agents.js'

const onModuleAgents = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onModuleAgents }))

const { readModuleAgents } = await import('./module-agents.js')

const runs = (id: string): ModuleAgent[] => [{ id, status: 'done', startedAt: '2026-10-26T10:00:00.000Z' }]

describe('readModuleAgents', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    onModuleAgents.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  test('two cards asking the same at once, or soon after, ask the daemon once; another question is its own read', async () => {
    onModuleAgents.mockResolvedValue(runs('a1'))
    const [hot, again] = await Promise.all([readModuleAgents('p-1', { ids: ['a1'] }), readModuleAgents('p-1', { ids: ['a1'] })])
    expect(hot).toBe(again)
    expect(onModuleAgents).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    await readModuleAgents('p-1', { ids: ['a1'] })
    expect(onModuleAgents).toHaveBeenCalledTimes(1) // answered a moment ago: that answer serves
    await readModuleAgents('p-1', { since: '2026-09-26T00:00:00.000Z' })
    expect(onModuleAgents).toHaveBeenLastCalledWith('p-1', { since: '2026-09-26T00:00:00.000Z' })
    expect(onModuleAgents).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3000)
    await readModuleAgents('p-1', { ids: ['a1'] })
    expect(onModuleAgents).toHaveBeenCalledTimes(3) // too old to serve
  })

  test('a failed read is not handed to the next asker', async () => {
    onModuleAgents.mockRejectedValueOnce(new Error('down')).mockResolvedValue(runs('a1'))
    await expect(readModuleAgents('p-2')).rejects.toThrow('down')
    expect(await readModuleAgents('p-2')).toEqual(runs('a1'))
    expect(onModuleAgents).toHaveBeenCalledTimes(2)
  })
})

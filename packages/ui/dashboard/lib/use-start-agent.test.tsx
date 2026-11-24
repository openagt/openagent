import { describe, test, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

const sendStart = vi.hoisted(() => vi.fn())
vi.mock('../rpc/control.js', () => ({ sendStart }))

import { useStartAgent } from './use-start-agent.js'

afterEach(() => {
  cleanup()
  sendStart.mockReset()
})

describe('useStartAgent', () => {
  test('a start that answers a run is one call, with the picks it was given', async () => {
    sendStart.mockResolvedValue({ ok: true, agentId: 'r1' })
    const { result } = renderHook(() => useStartAgent())
    let started: unknown
    await act(async () => void (started = await result.current.start('p1', 'go', { options: { 'agent-driver': { model: 'opus' } } })))
    expect(started).toEqual({ ok: true, agentId: 'r1' })
    expect(sendStart).toHaveBeenCalledTimes(1)
    expect(sendStart).toHaveBeenCalledWith('p1', 'go', { options: { 'agent-driver': { model: 'opus' } } })
    expect(result.current.error).toBeNull()
  })

  test('a refusal is shown as it is, and answers no run', async () => {
    sendStart.mockResolvedValue({ ok: false, error: 'Claude Code is not logged in.' })
    const { result } = renderHook(() => useStartAgent())
    let started: unknown = 'not yet'
    await act(async () => void (started = await result.current.start('p1', 'go')))
    expect(started).toBeUndefined()
    expect(result.current.error).toBe('Claude Code is not logged in.')
    expect(result.current.busy).toBe(false)
  })
})

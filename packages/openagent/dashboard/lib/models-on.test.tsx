import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { forgetRemembered } from '@openagt/skill-ui/module'

const HERE = { 'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5' }] }, codex: { models: [], error: '`codex` could not start: spawn codex ENOENT' } }
const THERE = { 'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5' }] }, codex: { models: [{ id: 'gpt-5.6', name: 'GPT-5.6' }] } }
const onModels = vi.hoisted(() => vi.fn())
const onMachineModels = vi.hoisted(() => vi.fn())
vi.mock('../rpc/models.js', () => ({ onModels }))
vi.mock('../rpc/machines.js', () => ({ onMachineModels }))

const { useModelsOn } = await import('./models.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  onModels.mockReset()
  onMachineModels.mockReset()
})

describe('the models a run can be given, on the machine picked in "Run on"', () => {
  test("a machine picked: that machine's own, asked of it, and nothing said until it answers", async () => {
    onModels.mockResolvedValue(HERE)
    let answer: (said: unknown) => void = () => {}
    onMachineModels.mockReturnValue(new Promise(resolve => (answer = resolve)))
    const { result } = renderHook(() => useModelsOn('laptop'))
    await waitFor(() => expect(onMachineModels).toHaveBeenCalledWith('laptop'))
    expect(result.current).toEqual({ models: undefined, theirs: true })
    answer(THERE)
    await waitFor(() => expect(result.current).toEqual({ models: THERE, theirs: true }))
  })

  test("none picked, or a machine that does not say: this computer's", async () => {
    onModels.mockResolvedValue(HERE)
    onMachineModels.mockResolvedValue(null)
    const here = renderHook(() => useModelsOn(undefined))
    await waitFor(() => expect(here.result.current).toEqual({ models: HERE, theirs: false }))
    expect(onMachineModels).not.toHaveBeenCalled()
    const older = renderHook(() => useModelsOn('old-box'))
    await waitFor(() => expect(older.result.current).toEqual({ models: HERE, theirs: false }))
  })
})

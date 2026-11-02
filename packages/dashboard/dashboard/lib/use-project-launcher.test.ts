import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { forgetRemembered } from './use-async.js'
import { useProjectLauncher } from './use-project-launcher.js'

const onCommands = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onCommands }))
const prefs = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('./preferences.js', () => ({ usePreferences: () => prefs.current }))

const FEATURE = { kind: 'published', branch: 'feature-x' } as const

afterEach(() => {
  cleanup()
  forgetRemembered()
  onCommands.mockReset()
  prefs.current = {}
})

describe('useProjectLauncher', () => {
  test('a command is read for the pick of this project, and a new pick is read at once, with the last answer standing until it lands', async () => {
    onCommands.mockResolvedValueOnce({ commands: [{ name: 'plan', waiting: 'main' }], startHook: true })
    prefs.current = { startFrom: { other: { kind: 'local' } } }
    const { result, rerender } = renderHook(({ id }) => useProjectLauncher(id), { initialProps: { id: 'p1' } })
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current?.commands).toEqual([{ name: 'plan', waiting: 'main' }]))
    expect(onCommands).toHaveBeenLastCalledWith('p1')

    let land: (value: unknown) => void = () => {}
    onCommands.mockReturnValueOnce(new Promise(resolve => (land = resolve)))
    prefs.current = { startFrom: { p1: FEATURE } }
    rerender({ id: 'p1' })
    await waitFor(() => expect(onCommands).toHaveBeenLastCalledWith('p1', FEATURE))
    expect(result.current?.commands, 'the row above the box does not blink').toEqual([{ name: 'plan', waiting: 'main' }])
    await act(async () => land({ commands: [{ name: 'plan' }], startHook: true }))
    expect(result.current?.commands).toEqual([{ name: 'plan' }])
  })

  test("another project's answer is never shown for this one", async () => {
    onCommands.mockResolvedValueOnce({ commands: [{ name: 'plan' }], startHook: true })
    const { result, rerender } = renderHook(({ id }) => useProjectLauncher(id), { initialProps: { id: 'p1' } })
    await waitFor(() => expect(result.current).not.toBeNull())
    onCommands.mockReturnValueOnce(new Promise(() => {}))
    rerender({ id: 'p2' })
    expect(result.current).toBeNull()
  })
})

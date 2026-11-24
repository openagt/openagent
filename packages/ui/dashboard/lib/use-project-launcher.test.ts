import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { forgetRemembered } from './use-async.js'
import { useProjectLauncher } from './use-project-launcher.js'

const onCommands = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onCommands }))

afterEach(() => {
  cleanup()
  forgetRemembered()
  onCommands.mockReset()
})

describe('useProjectLauncher', () => {
  test("another project's answer is never shown for this one", async () => {
    onCommands.mockResolvedValueOnce({ startFrom: { main: 'main', local: 'b' } })
    const { result, rerender } = renderHook(({ id }) => useProjectLauncher(id), { initialProps: { id: 'p1' } })
    await waitFor(() => expect(result.current).not.toBeNull())
    onCommands.mockReturnValueOnce(new Promise(() => {}))
    rerender({ id: 'p2' })
    expect(result.current).toBeNull()
  })
})

import { describe, expect, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAction } from './use-action.js'

describe('useAction', () => {
  test('a successful action carries its value, sets no error, and settles busy', async () => {
    const { result } = renderHook(() => useAction())
    let out: unknown
    await act(async () => {
      out = await result.current.run(async () => ({ ok: true, url: 'x' }))
    })
    expect(out).toEqual({ ok: true, value: { ok: true, url: 'x' } })
    expect(result.current.busy).toBe(false)
    expect(result.current.error).toBe(null)
  })

  test('a { ok: false } result routes into error and reports the action as not ok', async () => {
    const { result } = renderHook(() => useAction())
    let out: unknown = 'sentinel'
    await act(async () => {
      out = await result.current.run(async () => ({ ok: false, error: 'nope' }))
    })
    expect(out).toEqual({ ok: false })
    expect(result.current.error).toBe('nope')
  })

  test('a thrown error routes into error, falling back when it carries no message', async () => {
    const { result } = renderHook(() => useAction())
    let out: unknown = 'sentinel'
    await act(async () => {
      out = await result.current.run(async () => {
        throw new Error('boom')
      })
    })
    expect(out).toEqual({ ok: false })
    expect(result.current.error).toBe('boom')
    await act(async () => {
      await result.current.run(async () => {
        throw 'x'
      }, 'fallback msg')
    })
    expect(result.current.error).toBe('fallback msg')
  })

  // The distinction the outcome exists for: an action that succeeds with nothing to report is
  // not a failure, and a caller must be able to tell the two apart without a stand-in value.
  test('an action that succeeds with nothing is ok, and tellable from one that failed', async () => {
    const { result } = renderHook(() => useAction())
    let succeeded: unknown = 'sentinel'
    await act(async () => {
      succeeded = await result.current.run(async () => {})
    })
    expect(succeeded).toEqual({ ok: true, value: undefined })
    expect(result.current.error).toBe(null)

    let failed: unknown = 'sentinel'
    await act(async () => {
      failed = await result.current.run(async () => {
        throw new Error('boom')
      })
    })
    expect(failed).toEqual({ ok: false })
    expect(result.current.error).toBe('boom')
  })

  test('reset clears the error', async () => {
    const { result } = renderHook(() => useAction())
    await act(async () => {
      await result.current.run(async () => ({ ok: false, error: 'e' }))
    })
    expect(result.current.error).toBe('e')
    act(() => result.current.reset())
    expect(result.current.error).toBe(null)
  })
})

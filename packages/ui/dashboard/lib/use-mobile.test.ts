import { afterEach, describe, expect, test } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useIsMobile } from './use-mobile.js'

const had = window.matchMedia
afterEach(() => {
  cleanup()
  window.matchMedia = had
})

describe('useIsMobile', () => {
  test('a browser that cannot say how wide it is reads as a wide screen', () => {
    expect(renderHook(() => useIsMobile()).result.current).toBe(false)
  })

  test('a phone is read as one at the first paint, and the answer follows the screen', () => {
    let matches = true
    const listeners = new Set<() => void>()
    const asked: string[] = []
    window.matchMedia = ((media: string) => {
      asked.push(media)
      return {
        get matches() {
          return matches
        },
        media,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      }
    }) as unknown as typeof window.matchMedia

    const seen: boolean[] = []
    const { result, unmount } = renderHook(() => {
      const mobile = useIsMobile()
      seen.push(mobile)
      return mobile
    })
    // Never a wide first paint on a phone: the sidebar would show for a frame.
    expect(seen[0]).toBe(true)
    // Word for word what Tailwind's `max-md` asks, so the classes and the hook never disagree.
    expect(asked[0]).toBe('(width < 48rem)')

    matches = false
    act(() => listeners.forEach(listener => listener()))
    expect(result.current).toBe(false)

    unmount()
    expect(listeners.size).toBe(0)
  })
})

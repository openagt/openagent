import { afterEach, describe, expect, test, vi } from 'vitest'

// The platform is read once, as the module loads: each case loads it again on the platform it names.
async function on(platform: string) {
  vi.resetModules()
  vi.stubGlobal('navigator', { ...navigator, platform })
  return import('./shortcut.js')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a shortcut, said as the platform has it', () => {
  test('on a Mac, held with ⌘ and said as one', async () => {
    const { MOD_KEY, shortcut } = await on('MacIntel')
    expect(MOD_KEY).toBe('⌘')
    expect(shortcut('B')).toBe('⌘B')
  })

  test('elsewhere, held with Ctrl and said with a plus: there is no ⌘ to press', async () => {
    const { MOD_KEY, shortcut } = await on('Linux x86_64')
    expect(MOD_KEY).toBe('Ctrl')
    expect(shortcut('⏎')).toBe('Ctrl+⏎')
  })
})

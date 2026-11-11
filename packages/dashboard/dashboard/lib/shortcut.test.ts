import { afterEach, describe, expect, test, vi } from 'vitest'

// The keyboard is read once, as the module loads: each platform loads it afresh.
async function onPlatform(platform: string): Promise<typeof import('./shortcut.js')> {
  vi.spyOn(Navigator.prototype, 'platform', 'get').mockReturnValue(platform)
  vi.resetModules()
  return import('./shortcut.js')
}

afterEach(() => vi.restoreAllMocks())

describe('a shortcut as the keyboard in front of the person names it', () => {
  test.each([
    ['MacIntel', '⌘', '⌘B'],
    ['iPhone', '⌘', '⌘B'],
    ['iPad', '⌘', '⌘B'],
    ['Linux x86_64', 'Ctrl', 'Ctrl+B'],
    ['Win32', 'Ctrl', 'Ctrl+B'],
  ])('on %s the key is %s, and B with it is %s', async (platform, key, withB) => {
    const { MOD_KEY, shortcut } = await onPlatform(platform)
    expect(MOD_KEY).toBe(key)
    expect(shortcut('B')).toBe(withB)
  })
})

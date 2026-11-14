import { afterEach, describe, expect, test, vi } from 'vitest'
import { pressed, SHORTCUTS, type ShortcutId } from './shortcut.js'

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

/** A key pressed on `target`, the body unless said. */
function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('which key press is which shortcut', () => {
  test('⌘ or Ctrl is taken on any keyboard, as the keys always were', () => {
    expect(pressed(press({ key: 'b', metaKey: true }), 'sidebar')).toBe(true)
    expect(pressed(press({ key: 'b', ctrlKey: true }), 'sidebar')).toBe(true)
    expect(pressed(press({ key: 'b' }), 'sidebar')).toBe(false)
    // Ctrl+Shift+B is the browser's own, as it was.
    expect(pressed(press({ key: 'B', ctrlKey: true, shiftKey: true }), 'sidebar')).toBe(false)
  })

  test('Enter sends, Shift+Enter is a new line, ⌘Enter sends for later, and each is only itself', () => {
    expect(pressed(press({ key: 'Enter' }), 'send')).toBe(true)
    expect(pressed(press({ key: 'Enter', shiftKey: true }), 'send')).toBe(false)
    expect(pressed(press({ key: 'Enter', altKey: true }), 'send')).toBe(false)
    expect(pressed(press({ key: 'Enter', ctrlKey: true }), 'send')).toBe(false)
    expect(pressed(press({ key: 'Enter', shiftKey: true }), 'newLine')).toBe(true)
    expect(pressed(press({ key: 'Enter', metaKey: true }), 'sendLater')).toBe(true)
  })

  test('a key pressed to compose a character is no shortcut', () => {
    expect(pressed(press({ key: 'Enter', isComposing: true }), 'send')).toBe(false)
    expect(pressed(press({ key: 'b', ctrlKey: true, isComposing: true }), 'sidebar')).toBe(false)
  })

  test('a digit typed into a field is the field’s; outside one it picks', () => {
    const field = document.createElement('textarea')
    expect(pressed(press({ key: '3' }), 'pick')).toBe(true)
    expect(pressed(press({ key: '0' }), 'pick')).toBe(false)
    expect(pressed(press({ key: '3' }, field), 'pick')).toBe(false)
  })
})

// Every source file of the dashboard, read as text: what a handler takes is read off it.
const SOURCES = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../**/node_modules/**'], { query: '?raw', import: 'default', eager: true })

describe('the table holds every key the dashboard takes', () => {
  test('the sources are read', () => {
    expect(Object.keys(SOURCES)).toContain('../App.tsx')
  })

  test('no handler reads ⌘ or Ctrl but through the table; a click’s own (in-place.ts) is no key', () => {
    const reading = Object.entries(SOURCES)
      .filter(([file, text]) => /\b(metaKey|ctrlKey)\b/.test(text) && !['./shortcut.ts', './in-place.ts'].includes(file))
      .map(([file]) => file)
    expect(reading).toEqual([])
  })

  test('every key listened for on the whole page is matched against the table', () => {
    const unmatched = Object.entries(SOURCES)
      .filter(([, text]) => /addEventListener\(\s*['"]keydown['"]/.test(text) && !/\bpressed\(/.test(text))
      .map(([file]) => file)
    expect(unmatched).toEqual([])
  })

  test('every shortcut in the table is taken by a handler, but the new line, which the message box’s editor takes itself', () => {
    const all = Object.values(SOURCES).join('\n')
    const untaken = (Object.keys(SHORTCUTS) as ShortcutId[]).filter(id => !new RegExp(`(pressed\\([^)]*|useShortcut\\()'${id}'`).test(all))
    expect(untaken).toEqual(['newLine'])
  })
})

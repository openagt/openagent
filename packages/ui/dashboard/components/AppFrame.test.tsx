import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The page's look from its first frame: index.html puts back the look kept last time, before
// anything is drawn, and AppFrame changes nothing until the person's preferences arrive, then
// applies them and keeps them for the next load.

const prefs = vi.hoisted(() => ({ value: {} as Record<string, unknown>, loaded: false }))
vi.mock('../lib/preferences.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  usePreferences: () => prefs.value,
  usePreferencesLoaded: () => prefs.loaded,
}))

const { AppFrame } = await import('./AppFrame.js')
const { KEPT_LOOK } = await import('../lib/kept-look.js')

/** The OS is dark or light, as the browser says. */
const osDark = (dark: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: dark && query.includes('dark'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList)

const root = document.documentElement
const clear = () => {
  root.className = ''
  root.removeAttribute('style')
  delete root.dataset['palette']
  delete root.dataset['accent']
  localStorage.clear()
}

beforeEach(clear)
afterEach(() => {
  cleanup()
  clear()
  vi.restoreAllMocks()
})

/** index.html's own script, run as the browser runs it before the first paint. */
function firstPaint(): void {
  const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!
  new Function(script)()
}

describe("the page's look from its first frame", () => {
  test('a light theme kept on a dark OS is light from the first paint, with its palette, accent and fonts', () => {
    osDark(true)
    localStorage.setItem(KEPT_LOOK, JSON.stringify({ theme: 'light', palette: 'neutral', accent: 'blue', style: '--font-app: Inter;' }))
    firstPaint()
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.dataset['palette']).toBe('neutral')
    expect(root.dataset['accent']).toBe('blue')
    expect(root.getAttribute('style')).toBe('--font-app: Inter;')
  })

  test("a first visit takes the OS's light or dark", () => {
    osDark(true)
    firstPaint()
    expect(root.classList.contains('dark')).toBe(true)
    clear()
    osDark(false)
    firstPaint()
    expect(root.classList.contains('dark')).toBe(false)
  })

  test("until the preferences arrive nothing is changed; then they are applied, and kept for the next load", () => {
    osDark(true)
    root.dataset['palette'] = 'neutral'
    prefs.value = {}
    prefs.loaded = false
    const { rerender } = render(<AppFrame>page</AppFrame>)
    // The first paint's look stands: no default put over it while the preferences are on their way.
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.dataset['palette']).toBe('neutral')
    expect(localStorage.getItem(KEPT_LOOK)).toBeNull()

    prefs.value = { theme: 'dark', palette: 'neutral' }
    prefs.loaded = true
    rerender(<AppFrame>page</AppFrame>)
    expect(root.classList.contains('dark')).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEPT_LOOK)!)).toMatchObject({ theme: 'dark', palette: 'neutral' })
  })
})

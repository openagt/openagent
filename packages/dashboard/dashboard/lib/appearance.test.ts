import { afterEach, expect, test } from 'vitest'
import { applyAppearance } from './appearance.js'

const root = document.documentElement

afterEach(() => applyAppearance(root, {}))

test('no pick is the page’s own look: no attributes, no font variables', () => {
  applyAppearance(root, {})
  expect(root.dataset.palette).toBeUndefined()
  expect(root.dataset.accent).toBeUndefined()
  expect(root.style.getPropertyValue('--font-app')).toBe('')
})

test('the palette and the primary colour are attributes the tokens answer to', () => {
  applyAppearance(root, { palette: 'neutral', accent: 'blue' })
  expect(root.dataset.palette).toBe('neutral')
  expect(root.dataset.accent).toBe('blue')
  applyAppearance(root, { palette: 'neutral' })
  expect(root.dataset.accent).toBeUndefined()
})

test('a primary colour is one of the palette’s own: Everforest’s on OpenAgent, which is the page with no palette named', () => {
  applyAppearance(root, { palette: 'openagent', accent: 'aqua' })
  expect(root.dataset.palette).toBeUndefined()
  expect(root.dataset.accent).toBe('aqua')
  // Tailwind's blue is Neutral's, not OpenAgent's.
  applyAppearance(root, { accent: 'blue' })
  expect(root.dataset.accent).toBeUndefined()
  applyAppearance(root, { palette: 'neutral', accent: 'aqua' })
  expect(root.dataset.accent).toBeUndefined()
})

test('a picked font is set by the name of the face it ships as; the file preview can follow the page font', () => {
  applyAppearance(root, { font: 'inter', codeFont: 'jetbrains-mono', documentFont: 'app' })
  expect(root.style.getPropertyValue('--font-app')).toBe("'Inter Variable', ui-sans-serif, system-ui, sans-serif")
  expect(root.style.getPropertyValue('--font-code')).toBe("'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace")
  expect(root.style.getPropertyValue('--font-document')).toBe('var(--font-app)')
  applyAppearance(root, { codeFont: 'ibm-plex-mono' })
  expect(root.style.getPropertyValue('--font-app')).toBe('')
  expect(root.style.getPropertyValue('--font-code')).toBe("'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace")
})

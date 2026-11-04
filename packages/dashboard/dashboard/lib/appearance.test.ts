import { afterEach, expect, test } from 'vitest'
import { applyAppearance, fontsHref } from './appearance.js'

const root = document.documentElement
const picked = () => document.getElementById('picked-fonts') as HTMLLinkElement | null

afterEach(() => applyAppearance(root, {}))

test('no pick is the page’s own look: no attributes, no font variables, nothing more loaded', () => {
  applyAppearance(root, {})
  expect(root.dataset.palette).toBeUndefined()
  expect(root.dataset.accent).toBeUndefined()
  expect(root.style.getPropertyValue('--font-app')).toBe('')
  expect(picked()).toBeNull()
})

test('the palette and the primary colour are attributes the tokens answer to', () => {
  applyAppearance(root, { palette: 'neutral', accent: 'blue' })
  expect(root.dataset.palette).toBe('neutral')
  expect(root.dataset.accent).toBe('blue')
  applyAppearance(root, { palette: 'neutral' })
  expect(root.dataset.accent).toBeUndefined()
})

test('a picked font is set and loaded; one the page already loads is only set; the file preview can follow the page font', () => {
  applyAppearance(root, { font: 'inter', codeFont: 'jetbrains-mono', documentFont: 'app' })
  expect(root.style.getPropertyValue('--font-app')).toBe("'Inter', ui-sans-serif, system-ui, sans-serif")
  expect(root.style.getPropertyValue('--font-code')).toContain("'JetBrains Mono'")
  expect(root.style.getPropertyValue('--font-document')).toBe('var(--font-app)')
  expect(picked()!.href).toBe(fontsHref(['Inter']))
  applyAppearance(root, { codeFont: 'geist-mono' })
  expect(root.style.getPropertyValue('--font-app')).toBe('')
  expect(picked()!.href).toBe('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&display=swap')
  applyAppearance(root, {})
  expect(picked()).toBeNull()
})

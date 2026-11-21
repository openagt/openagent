import { accentOf, CODE_FONTS, DOCUMENT_FONTS, FONTS, fontFace } from '../../src/client.js'
import type { Preferences } from '../../src/index.js'

/** The fields of the preferences that say how the page looks. */
export type Look = { [K in 'palette' | 'accent' | 'font' | 'codeFont' | 'documentFont']?: Preferences[K] | undefined }

// How the page looks beyond light or dark (Settings › Appearance), put on the page: the palette
// and the primary colour as attributes of <html>, which the tokens in tailwind.css answer to, and
// the three fonts as the variables `font-sans`, `font-mono` and `font-serif` read (lib/fonts.ts
// ships their files).

const FALLBACKS = {
  app: 'ui-sans-serif, system-ui, sans-serif',
  code: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  document: 'ui-serif, Georgia, serif',
}

/** Put the person's look on the page's root element. */
export function applyAppearance(root: HTMLElement, preferences: Look): void {
  // OpenAgent's own colours are the page with no palette named, as tailwind.css reads them.
  if (preferences.palette && preferences.palette !== 'openagent') root.dataset.palette = preferences.palette
  else delete root.dataset.palette
  const accent = accentOf(preferences.palette, preferences.accent)
  if (accent) root.dataset.accent = accent
  else delete root.dataset.accent

  const app: string | undefined = preferences.font ? FONTS[preferences.font] : undefined
  const code: string | undefined = preferences.codeFont ? CODE_FONTS[preferences.codeFont] : undefined
  const document: string | undefined = preferences.documentFont && preferences.documentFont !== 'app' ? DOCUMENT_FONTS[preferences.documentFont] : undefined
  setFont(root, '--font-app', app, FALLBACKS.app)
  setFont(root, '--font-code', code, FALLBACKS.code)
  if (preferences.documentFont === 'app') root.style.setProperty('--font-document', 'var(--font-app)')
  else setFont(root, '--font-document', document, FALLBACKS.document)
}

function setFont(root: HTMLElement, name: string, family: string | undefined, fallback: string) {
  if (family) root.style.setProperty(name, `'${fontFace(family)}', ${fallback}`)
  else root.style.removeProperty(name)
}

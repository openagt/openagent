import { CODE_FONTS, DOCUMENT_FONTS, FONTS } from '../../src/client.js'
import type { Preferences } from '../../src/index.js'

/** The fields of the preferences that say how the page looks. */
export type Look = { [K in 'palette' | 'accent' | 'font' | 'codeFont' | 'documentFont']?: Preferences[K] | undefined }

// How the page looks beyond light or dark (Settings › Appearance), put on the page: the palette
// and the primary colour as attributes of <html>, which the tokens in tailwind.css answer to, and
// the three fonts as the variables `font-sans`, `font-mono` and `font-serif` read. A font that is
// not one of the defaults index.html loads is loaded the same way, from Google Fonts.

const FALLBACKS = {
  app: 'ui-sans-serif, system-ui, sans-serif',
  code: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  document: 'ui-serif, Georgia, serif',
}

/** The families index.html already loads. */
const LOADED = new Set(['Figtree', 'JetBrains Mono', 'Source Serif 4'])

const LINK_ID = 'picked-fonts'

/** The Google Fonts stylesheet for these families, at the weights the page uses. */
export function fontsHref(families: readonly string[]): string {
  const params = families.map(family => `family=${family.replace(/ /g, '+')}:wght@400;500;600;700`)
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`
}

/** Put the person's look on the page's root element. */
export function applyAppearance(root: HTMLElement, preferences: Look): void {
  if (preferences.palette) root.dataset.palette = preferences.palette
  else delete root.dataset.palette
  if (preferences.accent) root.dataset.accent = preferences.accent
  else delete root.dataset.accent

  const app: string | undefined = preferences.font ? FONTS[preferences.font] : undefined
  const code: string | undefined = preferences.codeFont ? CODE_FONTS[preferences.codeFont] : undefined
  const document: string | undefined = preferences.documentFont && preferences.documentFont !== 'app' ? DOCUMENT_FONTS[preferences.documentFont] : undefined
  setFont(root, '--font-app', app, FALLBACKS.app)
  setFont(root, '--font-code', code, FALLBACKS.code)
  if (preferences.documentFont === 'app') root.style.setProperty('--font-document', 'var(--font-app)')
  else setFont(root, '--font-document', document, FALLBACKS.document)

  const toLoad = [app, code, document].filter((family): family is string => family !== undefined && !LOADED.has(family))
  const doc = root.ownerDocument
  let link = doc.getElementById(LINK_ID) as HTMLLinkElement | null
  if (toLoad.length === 0) {
    link?.remove()
    return
  }
  if (!link) {
    link = doc.createElement('link')
    link.id = LINK_ID
    link.rel = 'stylesheet'
    doc.head.appendChild(link)
  }
  const href = fontsHref(toLoad)
  if (link.href !== href) link.href = href
}

function setFont(root: HTMLElement, name: string, family: string | undefined, fallback: string) {
  if (family) root.style.setProperty(name, `'${family}', ${fallback}`)
  else root.style.removeProperty(name)
}

// How the dashboard looks, beyond light or dark: its colours, the colour of its buttons and links,
// and its three fonts, each a pick from a short list. The lists are shared by the daemon, which
// keeps only a known pick in the person's preferences, and by the page, which offers and applies
// them. No pick is the first of each list: the dashboard's own look.

/** The page's colours: OpenAgent's own, Everforest's, or shadcn's neutral greys. */
export const PALETTES = ['openagent', 'neutral'] as const
export type Palette = (typeof PALETTES)[number]

export const PALETTE_LABELS: Record<Palette, string> = { openagent: 'OpenAgent', neutral: 'Neutral' }

/**
 * The colour of buttons, links and what is picked, from the palette's own colours: OpenAgent's
 * are Everforest's (its blue, the default, is none picked), Neutral's are Tailwind's as shadcn
 * offers them (its near-white, the default, is none picked).
 */
export const ACCENTS = {
  openagent: ['green', 'aqua', 'yellow', 'orange', 'red', 'purple'],
  neutral: ['amber', 'blue', 'cyan', 'emerald', 'fuchsia', 'green', 'indigo', 'lime', 'orange', 'pink', 'purple', 'red', 'rose', 'sky', 'teal', 'violet', 'yellow'],
} as const satisfies Record<Palette, readonly string[]>
export type Accent = (typeof ACCENTS)[Palette][number]

/** What the primary colour is called with none picked, per palette. */
export const DEFAULT_ACCENT_LABELS: Record<Palette, string> = { openagent: 'Blue', neutral: 'The colours’ own' }

/** The picked colour if it is one of the palette's, else none: a colour of the other palette's list does not carry over. */
export function accentOf(palette: Palette | undefined, accent: unknown): Accent | undefined {
  return (ACCENTS[palette ?? 'openagent'] as readonly unknown[]).includes(accent) ? (accent as Accent) : undefined
}

/** The font of the page and the chat, by its family's name. */
export const FONTS = {
  figtree: 'Figtree',
  inter: 'Inter',
  geist: 'Geist',
  'ibm-plex-sans': 'IBM Plex Sans',
  'plus-jakarta-sans': 'Plus Jakarta Sans',
  manrope: 'Manrope',
} as const
export type Font = keyof typeof FONTS

/** The font of code: code blocks, a read's lines, the Files pane's files. */
export const CODE_FONTS = {
  'jetbrains-mono': 'JetBrains Mono',
  'geist-mono': 'Geist Mono',
  'ibm-plex-mono': 'IBM Plex Mono',
  'fira-code': 'Fira Code',
  'source-code-pro': 'Source Code Pro',
} as const
export type CodeFont = keyof typeof CODE_FONTS

/** The font a Markdown file is read in, in the Files pane: a serif, as Claude Code on the web's, or the page's own (`app`). */
export const DOCUMENT_FONTS = {
  'source-serif-4': 'Source Serif 4',
  newsreader: 'Newsreader',
  literata: 'Literata',
  app: 'The page’s font',
} as const
export type DocumentFont = keyof typeof DOCUMENT_FONTS

export const isPalette = (value: unknown): value is Palette => (PALETTES as readonly unknown[]).includes(value)
export const isFont = (value: unknown): value is Font => typeof value === 'string' && Object.hasOwn(FONTS, value)
export const isCodeFont = (value: unknown): value is CodeFont => typeof value === 'string' && Object.hasOwn(CODE_FONTS, value)
export const isDocumentFont = (value: unknown): value is DocumentFont => typeof value === 'string' && Object.hasOwn(DOCUMENT_FONTS, value)

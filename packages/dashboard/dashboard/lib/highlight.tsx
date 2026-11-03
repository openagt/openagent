import { useEffect, useState, type CSSProperties } from 'react'
import type { HighlighterCore, LanguageRegistration, ThemeRegistration } from 'shiki/core'

// Colours by language for a file's lines, as an editor shows them: Shiki, with its Everforest light
// and dark themes, the family the dashboard's own colours come from. Each line comes back as its
// coloured pieces, so a pane keeps drawing its own rows (numbers, a diff's signs) and colours only
// the text. A language's grammar is loaded the first time a file of it is shown; the page loads
// none until then. A file of a language not listed, or too long to colour at once, stays plain.

/** The grammars a file may be coloured by, each loaded the first time a file of it is shown. */
const GRAMMARS: Record<string, () => Promise<{ default: LanguageRegistration[] }>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  json5: () => import('shiki/langs/json5.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  astro: () => import('shiki/langs/astro.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  sass: () => import('shiki/langs/sass.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  mdx: () => import('shiki/langs/mdx.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  dotenv: () => import('shiki/langs/dotenv.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  fish: () => import('shiki/langs/fish.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  prisma: () => import('shiki/langs/prisma.mjs'),
  proto: () => import('shiki/langs/proto.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
}

/** A file's language by its extension, or its whole name. */
const LANGUAGES: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'jsonc', json5: 'json5',
  html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte', astro: 'astro', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  md: 'markdown', mdx: 'mdx', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', env: 'dotenv',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', fish: 'fish', ps1: 'powershell',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp', php: 'php', lua: 'lua',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', prisma: 'prisma', proto: 'proto',
  dockerfile: 'docker', makefile: 'make', diff: 'diff', patch: 'diff',
}

/** What is coloured at once: past this a file stays plain, rather than holding the page while it is read. */
const MAX_CHARS = 200_000

/** The language a fenced code block names (```bash, ```ts, ```python), as an extension or as a grammar's own name. */
export function languageOfFence(name: string): string | undefined {
  const lower = name.trim().toLowerCase()
  if (lower === '' || lower === 'text' || lower === 'plain') return undefined
  if (lower === 'shell' || lower === 'console' || lower === 'terminal') return 'shellscript'
  return LANGUAGES[lower] ?? (lower in GRAMMARS ? lower : undefined)
}

export function languageOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  return LANGUAGES[dot === -1 ? name : name.slice(dot + 1)]
}

let highlighter: Promise<HighlighterCore> | undefined
const loading = new Map<string, Promise<void>>()

/**
 * The colours a code block in the chat is drawn in: one hue per kind of word, bright on dark and
 * deep on light — commands and functions blue, strings and a command's arguments green, keywords
 * purple, numbers and constants teal. A file's lines keep the editor's Everforest; only the chat's
 * blocks read like this, as a reply's code does in the chats people compare ours with.
 */
function chatTheme(name: string, dark: boolean): ThemeRegistration {
  const c = (onDark: string, onLight: string) => (dark ? onDark : onLight)
  return {
    name,
    type: dark ? 'dark' : 'light',
    colors: { 'editor.foreground': c('#eaecf0', '#14181f') },
    tokenColors: [
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: c('#818898', '#6e7687') } },
      { scope: ['punctuation', 'meta.brace', 'keyword.operator.type.annotation', 'keyword.operator.optional'], settings: { foreground: c('#d3d7de', '#2b303b') } },
      { scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control', 'keyword.operator.new', 'keyword.operator.expression', 'variable.language.this'], settings: { foreground: c('#cc7bf4', '#8100c2') } },
      { scope: ['keyword.operator.assignment', 'keyword.operator.arithmetic', 'keyword.operator.comparison', 'keyword.operator.relational', 'keyword.operator.logical', 'keyword.operator.pipe', 'keyword.operator.bitwise', 'keyword.operator.type'], settings: { foreground: c('#eaecf0', '#14181f') } },
      { scope: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string', 'constant.other.option', 'string.unquoted.argument', 'markup.inline.raw'], settings: { foreground: c('#9be963', '#008000') } },
      { scope: ['constant.numeric', 'constant.language', 'constant.character', 'support.constant'], settings: { foreground: c('#5eeded', '#008080') } },
      { scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function', 'entity.name.command', 'support.function.builtin', 'entity.name.tag'], settings: { foreground: c('#70b8ff', '#0051c2') } },
      { scope: ['meta.object-literal.key', 'support.type.property-name', 'entity.other.attribute-name', 'variable.other.property.yaml', 'entity.name.tag.yaml'], settings: { foreground: c('#f47b85', '#b80a18') } },
      { scope: ['variable.parameter'], settings: { foreground: c('#f7ab5f', '#b84f05') } },
      { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'support.type.primitive'], settings: { foreground: c('#fbad60', '#b34a00') } },
    ],
  }
}

/** Which colours a text is drawn in: an editor's, for a file's lines, or the chat's, for a reply's code block. */
export type Palette = 'editor' | 'chat'

const PALETTES: Record<Palette, { light: string; dark: string }> = {
  editor: { light: 'everforest-light', dark: 'everforest-dark' },
  chat: { light: 'chat-light', dark: 'chat-dark' },
}

function load(): Promise<HighlighterCore> {
  highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      themes: [import('shiki/themes/everforest-light.mjs'), import('shiki/themes/everforest-dark.mjs'), chatTheme('chat-light', false), chatTheme('chat-dark', true)],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    }),
  )
  return highlighter
}

async function withLanguage(language: string): Promise<HighlighterCore> {
  const shiki = await load()
  if (!loading.has(language)) loading.set(language, GRAMMARS[language]!().then(grammar => shiki.loadLanguage(...grammar.default)))
  await loading.get(language)
  return shiki
}

/** One line's coloured pieces: the text, and its colour in the light theme and in the dark one. */
export type Piece = { text: string; light: string | undefined; dark: string | undefined }

/**
 * The lines of `text` in colour, by the language `path` names: null while its grammar loads, and
 * for a file that stays plain.
 */
export function useHighlighted(text: string, path: string): Piece[][] | null {
  return useHighlightedIn(text, languageOf(path))
}

/** The same, for a language already known (a fenced block names its own), in the colours of `palette`. */
export function useHighlightedIn(text: string, language: string | undefined, palette: Palette = 'editor'): Piece[][] | null {
  const [shown, setShown] = useState<{ text: string; language: string; lines: Piece[][] } | null>(null)
  useEffect(() => {
    if (!language || text.length > MAX_CHARS) return
    let current = true
    withLanguage(language)
      .then(shiki => {
        if (!current) return
        const tokens = shiki.codeToTokensWithThemes(text, { lang: language, themes: PALETTES[palette] })
        setShown({ text, language, lines: tokens.map(line => line.map(token => ({ text: token.content, light: token.variants.light?.color, dark: token.variants.dark?.color }))) })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [text, language, palette])
  return shown && shown.text === text && shown.language === language ? shown.lines : null
}

/** One line's pieces, each in its colour for the page's theme. */
export function Pieces({ pieces }: { pieces: Piece[] }) {
  return pieces.map((piece, i) => (
    <span key={i} style={{ '--light': piece.light, '--dark': piece.dark } as CSSProperties} className="text-(color:--light) dark:text-(color:--dark)">
      {piece.text}
    </span>
  ))
}

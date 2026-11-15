import { Fragment, useEffect, useState } from 'react'
import type { HighlighterCore, LanguageRegistration, ThemeRegistration } from 'shiki/core'

// Colours by language for code, in the chat and in the panes: Shiki reads which kind of word each
// piece is (a keyword, a string, a comment…), and the page colours each kind with its theme's own
// hue (`--code-*`, tailwind.css), so the colours follow the theme, light or dark, OpenAgent's or
// Neutral, with nothing coloured again. Each line comes back as its pieces, so a pane keeps drawing its own rows (numbers, a diff's signs) and colours only
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
 * The kinds of word code is coloured by, in Claude Code on the web's way of telling them apart:
 * commands and functions, strings and a command's arguments, keywords, numbers with their units
 * and colours, a markup tag's name with a property's, an attribute's name, a parameter, a type.
 * Each is drawn in `--code-<kind>`.
 */
export const KINDS = ['plain', 'comment', 'punctuation', 'keyword', 'operator', 'string', 'number', 'function', 'property', 'attribute', 'parameter', 'type'] as const
export type Kind = (typeof KINDS)[number]

/** Which words are of which kind, by their TextMate scopes. */
const SCOPES: Record<Exclude<Kind, 'plain'>, string[]> = {
  comment: ['comment', 'punctuation.definition.comment'],
  punctuation: ['punctuation', 'meta.brace', 'keyword.operator.type.annotation', 'keyword.operator.optional'],
  keyword: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control', 'keyword.operator.new', 'keyword.operator.expression', 'variable.language.this'],
  operator: ['keyword.operator.assignment', 'keyword.operator.arithmetic', 'keyword.operator.comparison', 'keyword.operator.relational', 'keyword.operator.logical', 'keyword.operator.pipe', 'keyword.operator.bitwise', 'keyword.operator.type'],
  string: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string', 'constant.other.option', 'string.unquoted.argument', 'markup.inline.raw'],
  number: ['constant.numeric', 'constant.language', 'constant.character', 'support.constant', 'keyword.other.unit', 'constant.other.color', 'punctuation.definition.constant'],
  function: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function', 'entity.name.command', 'support.function.builtin'],
  property: ['meta.object-literal.key', 'support.type.property-name', 'punctuation.support.type.property-name', 'entity.name.tag', 'variable.other.property.yaml', 'entity.name.tag.yaml'],
  attribute: ['entity.other.attribute-name'],
  parameter: ['variable.parameter'],
  type: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'support.type.primitive'],
}

/** A kind as the stand-in colour the theme gives it, which Shiki hands back on each piece: its place in the list. */
const stand = (kind: Kind) => `#0000${KINDS.indexOf(kind).toString(16).padStart(2, '0')}`
const KIND_OF = new Map(KINDS.map(kind => [stand(kind), kind]))

/** The theme Shiki colours with: a kind per scope, said as its stand-in colour. */
const CODE_THEME: ThemeRegistration = {
  name: 'code-kinds',
  type: 'dark',
  colors: { 'editor.foreground': stand('plain') },
  tokenColors: Object.entries(SCOPES).map(([kind, scope]) => ({ scope, settings: { foreground: stand(kind as Kind) } })),
}

function load(): Promise<HighlighterCore> {
  highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      themes: [CODE_THEME],
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

/** One line's coloured pieces: the text, and the kind of word it is. */
export type Piece = { text: string; kind: Kind }

/**
 * The lines of `text` in colour, by the language `path` names: null while its grammar loads, and
 * for a file that stays plain.
 */
export function useHighlighted(text: string, path: string): Piece[][] | null {
  return useHighlightedIn(text, languageOf(path))
}

/** The same, for a language already known (a fenced block names its own). */
export function useHighlightedIn(text: string, language: string | undefined): Piece[][] | null {
  const [shown, setShown] = useState<{ text: string; language: string; lines: Piece[][] } | null>(null)
  useEffect(() => {
    if (!language || text.length > MAX_CHARS) return
    let current = true
    withLanguage(language)
      .then(shiki => {
        if (!current) return
        const tokens = shiki.codeToTokens(text, { lang: language, theme: CODE_THEME.name! }).tokens
        setShown({ text, language, lines: tokens.map(line => line.map(token => ({ text: token.content, kind: KIND_OF.get(token.color?.toLowerCase() ?? '') ?? 'plain' }))) })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [text, language])
  return shown && shown.text === text && shown.language === language ? shown.lines : null
}

/** One line's pieces, each in its kind's colour for the page's theme. */
export function Pieces({ pieces }: { pieces: Piece[] }) {
  return pieces.map((piece, i) => (
    <span key={i} style={{ color: `var(--code-${piece.kind})` }}>
      {piece.text}
    </span>
  ))
}

/** Lines in colour, a new line between two: a block of code drawn whole, in its `<pre>`. */
export function ColouredLines({ lines }: { lines: Piece[][] }) {
  return lines.map((pieces, i) => (
    <Fragment key={i}>
      <Pieces pieces={pieces} />
      {i < lines.length - 1 ? '\n' : null}
    </Fragment>
  ))
}

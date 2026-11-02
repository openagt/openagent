import { useEffect, useState, type CSSProperties } from 'react'
import type { HighlighterCore, LanguageRegistration } from 'shiki/core'

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

export function languageOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  return LANGUAGES[dot === -1 ? name : name.slice(dot + 1)]
}

let highlighter: Promise<HighlighterCore> | undefined
const loading = new Map<string, Promise<void>>()

function load(): Promise<HighlighterCore> {
  highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      themes: [import('shiki/themes/everforest-light.mjs'), import('shiki/themes/everforest-dark.mjs')],
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
  const language = languageOf(path)
  const [shown, setShown] = useState<{ text: string; language: string; lines: Piece[][] } | null>(null)
  useEffect(() => {
    if (!language || text.length > MAX_CHARS) return
    let current = true
    withLanguage(language)
      .then(shiki => {
        if (!current) return
        const tokens = shiki.codeToTokensWithThemes(text, { lang: language, themes: { light: 'everforest-light', dark: 'everforest-dark' } })
        setShown({ text, language, lines: tokens.map(line => line.map(token => ({ text: token.content, light: token.variants.light?.color, dark: token.variants.dark?.color }))) })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [text, language])
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

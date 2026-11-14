import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { compile } from 'tailwindcss'

const require = createRequire(import.meta.url)

/** A module's own rules: CSS of its own that is no class of the vocabulary (its `styles.css`). */
export interface ModuleRules {
  /** The module they are of, named when they are refused. */
  module: string
  css: string
}

/** What would change what a name means: only the dashboard's vocabulary says that. */
const VOCABULARY_STATEMENT = /@(?:theme|custom-variant|variant|utility|plugin|config|import)\b/

/**
 * One sheet with a rule for every name in `names` that the vocabulary (the dashboard's
 * `module/theme.css`, as text) draws, in Tailwind's one order, and each module's own rules after
 * them. A module's rules that say a vocabulary statement are refused, naming the module and the
 * statement: a module draws with the dashboard's names, it never changes them.
 */
export async function compileStyles(vocabulary: string, rules: readonly ModuleRules[], names: readonly string[]): Promise<string> {
  for (const { module, css } of rules) {
    const statement = css.replace(/\/\*[\s\S]*?\*\//g, '').match(VOCABULARY_STATEMENT)
    if (statement) throw new Error(`${module}'s styles.css says ${statement[0]}: a module's own rules cannot change the dashboard's vocabulary`)
  }
  const entry = ['@layer theme, base, components, utilities;', "@import 'tailwindcss/theme' layer(theme);", "@import 'tailwindcss/utilities' layer(utilities);", vocabulary, ...rules.map(each => each.css)].join('\n')
  const compiler = await compile(entry, {
    // Only Tailwind's own two sheets are imported: the vocabulary has no import, and a module's rules may not.
    loadStylesheet: async id => {
      const path = require.resolve(`${id}.css`)
      return { path, base: dirname(path), content: await readFile(path, 'utf8') }
    },
  })
  return compiler.build([...names])
}

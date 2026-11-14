import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { twMerge } from 'tailwind-merge'

// A module's stylesheet loads after the dashboard's, and in no set order with the other modules'.
// Each one carries its own copy of the utilities its own code uses, in the same `utilities` layer.
// So where one element has two utilities that set the same property, the one Tailwind orders to win
// (a longhand over its shorthand, `pl-7` over `px-3`; a width's or a pointer's variant over the plain class,
// `max-md:pl-11` over `pl-4`, `pointer-coarse:hidden` over `flex`) loses on any page whose module carries the other alone, as a later copy. Reads the
// builds: `pnpm build` first.

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url))

/** Classes written as the two sides of a condition (`a ? 'x' : 'y'`), never on one element. */
const APART = new Set(['md:min-w-24 min-w-0', 'overflow-x-clip overflow-hidden'])

/** A rule of a utility: where it applies (`@media …`), how specific it is, and what it sets, by physical longhand. */
type Rule = { at: string; specificity: number; sets: Map<string, string> }

/** The utilities a built stylesheet defines, by class. */
function utilities(css: string): Map<string, Rule[]> {
  const found = new Map<string, Rule[]>()
  const open: string[] = []
  let start = 0
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '}') {
      open.pop()
      start = i + 1
    } else if (css[i] === ';' && open.length === 0) start = i + 1
    else if (css[i] === '{') {
      const prelude = css.slice(start, i).trim()
      const end = css.indexOf('}', i)
      const body = css.slice(i + 1, end)
      if (css.indexOf('{', i + 1) < end && css.indexOf('{', i + 1) !== -1) {
        open.push(prelude)
        start = i + 1
        continue
      }
      if (open[0] === '@layer utilities') {
        const nesting = [...open, prelude]
        const selector = nesting.filter(p => !p.startsWith('@')).reduce((outer, inner) => (inner.includes('&') ? inner.replaceAll('&', outer) : inner), '')
        const name = /^\.((?:\\.|[^\s.:#[\\>+~,()])+)/.exec(selector)?.[1]?.replace(/\\(.)/g, '$1')
        // A value that reads one of Tailwind's own variables (`line-height: var(--tw-leading, …)`) takes what the
        // other utility sets there, in any order; one marked important wins in any order.
        const sets = new Map(
          body
            .split(';')
            .map(declaration => [declaration.slice(0, declaration.indexOf(':')).trim(), declaration.slice(declaration.indexOf(':') + 1).trim()] as const)
            .filter(([, value]) => !value.includes('var(--tw-') && !value.endsWith('!important'))
            .flatMap(([property, value]) => longhands(property).map(side => [side, value] as const)),
        )
        if (name) found.set(name, [...(found.get(name) ?? []), { at: nesting.filter(p => p.startsWith('@media')).join(' '), specificity: specificity(selector), sets }])
      }
      i = end
      start = end + 1
    }
  }
  return found
}

/** What a property sets, as physical longhands: `padding-inline` is `padding-left` and `padding-right`. */
function longhands(property: string): string[] {
  if (!property || property.startsWith('--')) return []
  const physical = property.replace(/inline-start/, 'left').replace(/inline-end/, 'right').replace(/block-start/, 'top').replace(/block-end/, 'bottom')
  const sides: Record<string, string[]> = { '': ['top', 'right', 'bottom', 'left'], '-inline': ['left', 'right'], '-block': ['top', 'bottom'] }
  for (const box of ['padding', 'margin', 'scroll-margin', 'scroll-padding']) {
    const axis = physical.startsWith(box) ? physical.slice(box.length) : undefined
    if (axis !== undefined && axis in sides) return sides[axis]!.map(side => `${box}-${side}`)
  }
  if (physical === 'inset' || physical === 'inset-inline' || physical === 'inset-block') return sides[physical.slice(5)]!
  const border = /^border(-inline|-block|)-(width|style|color)$/.exec(physical)
  if (border) return sides[border[1]!]!.map(side => `border-${side}-${border[2]}`)
  if (physical === 'border-radius') return ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(corner => `border-${corner}-radius`)
  const shorthands: Record<string, string[]> = { gap: ['row-gap', 'column-gap'], flex: ['flex-grow', 'flex-shrink', 'flex-basis'], overflow: ['overflow-x', 'overflow-y'] }
  return shorthands[physical] ?? [physical]
}

/** Classes, attributes and pseudo-classes; `:where(…)` counts for nothing. */
function specificity(selector: string): number {
  return selector.replace(/:where\([^)]*\)/g, '').replace(/\\./g, 'x').match(/[.[]|:(?!:)/g)?.length ?? 0
}

/**
 * The groups of classes written for one element: a `className`, a `cn(…)`, and a shared component's own
 * classes with those its callers pass it, after `cn` has dropped the ones a later class replaces.
 */
function groups(sources: Map<string, string>, shared: Map<string, { file: string; code: string }>): { file: string; classes: string[] }[] {
  const found: { file: string; classes: string[] }[] = []
  const words = (code: string) => [...code.matchAll(/(?<!\w)(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].flatMap(match => match[2]!.split(/\s+/)).filter(Boolean)
  for (const [file, code] of sources) {
    for (const match of code.matchAll(/className=|\bcn(?=\()|\bcva(?=\()/g)) {
      const written = words(balanced(code, match.index + match[0].length))
      found.push({ file, classes: match[0] === 'className=' ? written : merged(written) })
    }
    for (const [component, own] of shared) {
      // A file's own component of the same name is not the shared one.
      if (file === own.file || new RegExp(`\\bfunction ${component}\\b`).test(code)) continue
      for (const match of code.matchAll(new RegExp(`<${component}\\b`, 'g'))) {
        const tag = openingTag(code, match.index)
        const className = ownClassName(tag)
        if (className !== undefined) found.push({ file, classes: merged([...words(own.code), ...words(balanced(tag, className + 10))]) })
      }
    }
  }
  return found
}

const merged = (classes: string[]) => twMerge(classes.join(' ')).split(' ')

/** The expression that starts at `from`: a quoted string, or up to its closing bracket. */
function balanced(code: string, from: number): string {
  let depth = 0
  for (let i = from; i < code.length; i++) {
    const c = code[i]!
    if (depth === 0 && (c === '"' || c === "'")) return code.slice(from, code.indexOf(c, i + 1) + 1)
    if (c === '{' || c === '(') depth++
    else if (c === '}' || c === ')') depth--
    if (depth <= 0 && i > from) return code.slice(from, i + 1)
  }
  return code.slice(from)
}

/** Where an opening tag's own `className=` starts: not one of an element passed in another prop (`leading={<Icon className=…/>}`). */
function ownClassName(tag: string): number | undefined {
  let depth = 0
  for (let i = 0; i < tag.length; i++) {
    const c = tag[i]!
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (depth === 0 && tag.startsWith('className=', i)) return i
  }
  return undefined
}

/** A JSX element's opening tag, from its `<`. */
function openingTag(code: string, from: number): string {
  let depth = 0
  for (let i = from; i < code.length; i++) {
    const c = code[i]!
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return code.slice(from, i + 1)
  }
  return code.slice(from)
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('.test.') && !entry.parentPath.includes('node_modules'))
    .map(entry => join(entry.parentPath, entry.name))
}

test("no module's stylesheet carries a utility alone that, on an element, another utility must beat", () => {
  const dashboardAssets = join(PACKAGES, 'dashboard/dist/dashboard-bundle/assets')
  assert.ok(existsSync(dashboardAssets), 'the dashboard is not built: run `pnpm build` first')
  const sheets = new Map<string, Map<string, Rule[]>>()
  const modules: string[] = []
  for (const file of readdirSync(dashboardAssets)) if (/^main-.*\.css$/.test(file)) sheets.set('dashboard', utilities(readFileSync(join(dashboardAssets, file), 'utf8')))
  const sources = new Map<string, string>()
  for (const name of readdirSync(PACKAGES)) {
    const sheet = join(PACKAGES, name, 'dist/dashboard/dashboard.css')
    if (existsSync(sheet)) {
      sheets.set(name, utilities(readFileSync(sheet, 'utf8')))
      modules.push(name)
    }
    if (existsSync(join(PACKAGES, name, 'dashboard'))) for (const file of tsxFiles(join(PACKAGES, name, 'dashboard'))) sources.set(file, readFileSync(file, 'utf8'))
  }
  assert.ok(modules.length > 0, 'no module is built: run `pnpm build` first')

  // A shared component's own classes: those of the `cn(…)` its callers' `className` joins, with the `cva(…)` it reads.
  const shared = new Map<string, { file: string; code: string }>()
  for (const [file, code] of sources) {
    if (!file.startsWith(join(PACKAGES, 'dashboard/dashboard/components/ui/'))) continue
    const components = [...code.matchAll(/export function ([A-Z]\w*)/g)]
    components.forEach((match, i) => {
      const body = code.slice(match.index, components[i + 1]?.index ?? code.length)
      const root = [...body.matchAll(/\bcn(?=\()/g)].map(call => balanced(body, call.index + 2)).find(call => /\bclassName\b/.test(call))
      if (!root) return
      const variants = [...code.matchAll(/const (\w+) = cva(?=\()/g)].filter(cva => root.includes(cva[1]!)).map(cva => balanced(code, cva.index + cva[0].length))
      shared.set(match[1]!, { file, code: [root, ...variants].join(' ') })
    })
  }

  const rules = new Map<string, Rule[]>()
  for (const sheet of sheets.values()) for (const [name, rule] of sheet) if (!rules.has(name)) rules.set(name, rule)
  /** `winner` is ordered after `loser` where both are written, and must stay so: it sets part of what `loser` sets, or sets it for one width or one pointer. */
  const beats = (winner: string, loser: string) =>
    rules.get(winner)!.some(w =>
      rules.get(loser)!.some(
        l =>
          w.specificity === l.specificity &&
          w.sets.size > 0 &&
          [...w.sets.keys()].every(side => l.sets.has(side)) &&
          [...w.sets].some(([side, value]) => l.sets.get(side) !== value) &&
          ((w.at === l.at && w.sets.size < l.sets.size) || (/width|pointer/.test(w.at) && l.at === '')),
      ),
    )

  const pairs = new Map<string, string>()
  for (const { file, classes } of groups(sources, shared)) {
    const known = [...new Set(classes)].filter(name => rules.has(name))
    for (const loser of known) for (const winner of known) if (winner !== loser) pairs.set(`${winner} ${loser}`, file.slice(PACKAGES.length))
  }
  const lost = new Set<string>()
  for (const [pair, file] of pairs) {
    const [winner, loser] = pair.split(' ') as [string, string]
    if (!APART.has(pair) && beats(winner, loser))
          for (const module of modules) {
            const sheet = sheets.get(module)!
            if (sheet.has(loser) && !sheet.has(winner)) lost.add(`${file}: \`${winner}\` loses to \`${module}\`'s own \`${loser}\``)
          }
  }
  assert.deepEqual([...lost], [], 'say the winning class for its own case only (`md:pl-4 max-md:pl-11`), or with `!` where it overrides a shared component’s own')
})

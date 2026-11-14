import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Every page and module draws with one closed scale: the steps of `dashboard/module/theme.css`.
// This reads the code of the dashboard and of every module for a class off it. What was off it
// when the scale came is in scale-baseline.json, which only ever shrinks.

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url))
const BASELINE = fileURLToPath(new URL('../../src/dashboard/scale-baseline.json', import.meta.url))

/** What is off the scale, and the step to use instead. */
const OFF_SCALE: { off: RegExp; use: string }[] = [
  { off: /^text-\[\d[^\]]*\]$|^text-lg$/, use: 'a type step: `text-xs` meta, `text-sm` body, `text-base` prose or a heading, `text-xl` a title' },
  { off: /^leading-\[[^\]]*\]$/, use: "the type step's own line height" },
  { off: /^(h|min-h|max-h)-\[\d+px\]$/, use: 'a control height, `h-7`, `h-8` or `h-9`, or a step of the spacing scale' },
  { off: /^gap(-x|-y)?-\[[^\]]*\]$/, use: 'a step of the spacing scale: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64 px' },
  { off: /^rounded(-[trblse]{1,2})?(-(xl|2xl|3xl|4xl))?$/, use: '`rounded-sm` inside a control, `rounded-md` a control, `rounded-lg` a surface, `rounded-full` a dot or a count' },
  { off: /^-?(p[xytrblse]?|m[xytrblse]?|gap(-x|-y)?|space-[xy])-(2\.5|3\.5)$/, use: 'a step of the spacing scale: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64 px' },
  { off: /^transition(-all)?$/, use: 'a transition that names what moves: `transition-colors`, `transition-opacity`, `transition-transform`' },
  { off: /^duration-(?!(90|100|120|140|180)$)/, use: 'a motion step: `duration-100` hover, `duration-140` a popover, `duration-180` a dialog, exits at `duration-90` and `duration-120`' },
  { off: /^text-[a-z-]+\/\d+$/, use: 'one of the three text colours: `text-foreground`, `text-muted-foreground`, `text-faint-foreground`' },
]

/** Classes off the scale on purpose, with the reason. */
const ALLOWED: Record<string, string> = {
  'text-[17px]': "BrandLink's wordmark: the website draws the same mark at the same size in the same place, and the switch between the two (the `oa-brand` view transition) keeps it still",
}

/** A class as written, without its variants and its `!`: `md:hover:px-2.5!` is `px-2.5`. */
function utility(written: string): string {
  return written.replace(/^.*:(?![^[]*\])/, '').replace(/^!|!$/g, '')
}

function offenders(): Record<string, Record<string, number>> {
  const found: Record<string, Record<string, number>> = {}
  for (const name of readdirSync(PACKAGES)) {
    const dir = join(PACKAGES, name, 'dashboard')
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.tsx') || entry.name.includes('.test.') || entry.parentPath.includes('node_modules')) continue
      const file = join(entry.parentPath, entry.name)
      for (const literal of readFileSync(file, 'utf8').matchAll(/(?<!\w)(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        const classes = literal[2]!.split(/\s+/).filter(Boolean)
        for (const written of classes) {
          const bare = utility(written)
          // A lone `rounded` or `transition` is a word of a sentence, not a class.
          if (classes.length === 1 && (bare === 'rounded' || bare === 'transition')) continue
          if (bare in ALLOWED || !OFF_SCALE.some(rule => rule.off.test(bare))) continue
          const at = relative(PACKAGES, file)
          found[at] ??= {}
          found[at][written] = (found[at][written] ?? 0) + 1
        }
      }
    }
  }
  return found
}

test('every class is on the scale of dashboard/module/theme.css, but for the ones it came to', () => {
  const today = offenders()
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, Record<string, number>>
  const added: string[] = []
  const gone: string[] = []
  for (const [file, classes] of Object.entries(today))
    for (const [written, count] of Object.entries(classes)) {
      if (count <= (baseline[file]?.[written] ?? 0)) continue
      const { use } = OFF_SCALE.find(rule => rule.off.test(utility(written)))!
      added.push(`${file}: \`${written}\` is off the scale (dashboard/module/theme.css); use ${use}`)
    }
  for (const [file, classes] of Object.entries(baseline))
    for (const [written, count] of Object.entries(classes))
      if ((today[file]?.[written] ?? 0) < count) gone.push(`${file}: \`${written}\` ${count} → ${today[file]?.[written] ?? 0}`)
  assert.deepEqual(added, [], 'a class off the scale')
  assert.deepEqual(gone, [], 'fewer classes off the scale than scale-baseline.json says: lower it there')
})

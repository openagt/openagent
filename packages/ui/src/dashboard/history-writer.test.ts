import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The tab's list of entries has one writer, `dashboard/lib/use-route.ts`: it stamps every entry
// with its place, which is how a Back refused by a change not saved returns to it. This reads the
// code of the dashboard and of every module for any other write.

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url))

/** A write to the tab's history or a navigation by `location`. */
const WRITE = /\bhistory\.(pushState|replaceState|back|forward|go)\s*\(|\blocation(\.(href|search|pathname|hash))?\s*=(?!=)|\blocation\.(assign|replace)\s*\(/g

/** The files that may write it, with the reason. */
const ALLOWED: Record<string, string> = {
  'ui/dashboard/lib/use-route.ts': 'the one writer',
  'ui/dashboard/components/ViewToggle.tsx': 'leaves the dashboard for the website, in place of its entry',
}

function writers(): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  for (const name of readdirSync(PACKAGES)) {
    const dir = join(PACKAGES, name, 'dashboard')
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || entry.name.includes('.test.') || /node_modules|\/dist/.test(entry.parentPath)) continue
      const file = join(entry.parentPath, entry.name)
      const at = relative(PACKAGES, file)
      if (at in ALLOWED) continue
      const writes = [...readFileSync(file, 'utf8').matchAll(WRITE)].map(match => match[0])
      if (writes.length > 0) found[at] = writes
    }
  }
  return found
}

test("only the dashboard's route writes the tab's history: a page or a module moves through the host", () => {
  assert.deepEqual(writers(), {})
})

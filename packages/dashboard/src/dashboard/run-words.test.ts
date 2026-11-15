import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// A run's state has one word and one mark wherever it is shown: `dashboard/lib/run-words.ts` holds
// them, and `RunMark` draws the mark. This reads the code of the dashboard and of every module for
// a run's state given a colour or a word anywhere else.

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url))

const STATES = 'running|waiting|saving|done|stopped|failed|merged|unknown'

/** A state given a colour: a map from it to a class of a text, a fill or a border. */
const COLOURED = new RegExp(`\\b(${STATES})\\s*:\\s*'(text|bg|border)-`, 'g')

/** The files that may, with the reason. */
const ALLOWED: Record<string, string> = {
  'dashboard/dashboard/lib/run-words.ts': 'the one table',
  'dashboard/dashboard/components/ServerLogins.tsx': "a login's states, not a run's",
}

function said(pattern: RegExp): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  for (const name of readdirSync(PACKAGES)) {
    const dir = join(PACKAGES, name, 'dashboard')
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || entry.name.includes('.test.') || /node_modules|\/dist/.test(entry.parentPath)) continue
      const file = join(entry.parentPath, entry.name)
      const at = relative(PACKAGES, file)
      if (at in ALLOWED) continue
      const lines = [...readFileSync(file, 'utf8').matchAll(pattern)].map(match => match[0])
      if (lines.length > 0) found[at] = lines
    }
  }
  return found
}

test("a run's state is given its colour in one table: no list keeps a map of its own", () => {
  assert.deepEqual(said(COLOURED), {})
})

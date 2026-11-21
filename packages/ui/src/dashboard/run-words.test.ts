import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// A run's state has one word and one mark wherever it is shown: `dashboard/lib/run-words.ts` holds
// them, and `RunMark` draws the mark. This reads the code of the dashboard and of every module for
// a run's state given a colour or a word anywhere else.

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url))

const STATES = 'running|waiting|saving|done|stopped|failed|merged'

/** A state given a colour: a map from it to a class of a text, a fill or a border. */
const COLOURED = new RegExp(`\\b(${STATES})\\s*:\\s*'(text|bg|border)-`, 'g')

/** A word picked for a state by comparing it: a word of a state's own, where a state is mapped to another it may be. */
const WORDED = new RegExp(`[sS]tatus\\s*===\\s*'(${STATES})'\\s*\\?\\s*'(?!(${STATES})')[^']*'`, 'g')

/** The files that may, with the reason. */
const ALLOWED: Record<string, string> = {
  'ui/dashboard/lib/run-words.ts': 'the one table',

  'ui/dashboard/components/ui/state.tsx': "where any piece of work stands (a queue entry, a ticket, a run), drawn as the look's cell: a run's state is mapped to one, its word and colour stay in the table",
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

test("a run's state is given its word in one table: no list picks one of its own", () => {
  assert.deepEqual(said(WORDED), {})
})

test("a run's state is given its colour in one table: no list keeps a map of its own", () => {
  assert.deepEqual(said(COLOURED), {})
})

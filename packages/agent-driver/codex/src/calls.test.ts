import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { saidCall } from '@openagt/hooks'
import { CODEX_CALLS } from './calls.js'

const said = (label: string, detail?: string) => saidCall(CODEX_CALLS, label, detail)

test("Codex's item kinds read as a verb and what it was done to", () => {
  assert.deepEqual(said('commandExecution', 'pnpm test'), { verb: 'Ran', doing: 'Running', target: 'pnpm test', detail: 'pnpm test', kind: 'command' })
  // A change names every file it made: each by its name, and none is the one it opens.
  assert.deepEqual(said('fileChange', '/repo/a.ts, /repo/src/b.ts'), { verb: 'Edited', doing: 'Editing', target: 'a.ts, b.ts', detail: '/repo/a.ts, /repo/src/b.ts', kind: 'edit' })
  assert.equal(said('fileChange', '/repo/a.ts').path, '/repo/a.ts')
  assert.deepEqual(said('mcpToolCall', 'github.search'), { verb: 'Called', doing: 'Calling', target: 'github.search', detail: 'github.search', kind: 'other' })
  assert.deepEqual(said('webSearch', 'vitest docs'), { verb: 'Searched the web', doing: 'Searching the web', target: 'vitest docs', detail: 'vitest docs', kind: 'web', plain: true })
})

test('every item kind has its word for a call still going on', () => {
  assert.deepEqual(['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].map(label => said(label).doing), ['Running', 'Editing', 'Calling', 'Searching the web'])
})

test('an item of a kind it does not word is said by its kind, as words', () => {
  assert.deepEqual(said('imageView'), { verb: 'Image view', doing: 'Image view', kind: 'other' })
})

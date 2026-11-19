import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createHooks, type DistributionEntry } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import mermaid from './module.js'

test("a plugin kept per person, with no step of a run: off until the person's row is on", async () => {
  assert.deepEqual(mermaid.plugin, { scope: 'person' })
  assert.deepEqual(mermaid.hooks, {})
  const store: DistributionEntry = { module: { name: 'test-store', hooks: { 'store.backend': memoryStore() } } }
  const hooks = createHooks([store, { module: mermaid }])
  assert.deepEqual((await hooks.on()).map(module => module.name), ['test-store'])
  await hooks.setEnabled('ui-renderer-mermaid', true)
  assert.deepEqual((await hooks.on()).map(module => module.name), ['test-store', 'ui-renderer-mermaid'])
})

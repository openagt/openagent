import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createHooks, type DistributionEntry, type ProjectRef } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import { WEB_HOST, hostClaudeWeb } from './module.js'

test('a plugin kept per computer, off until a person switches it on: only then does "Run on" offer Claude Code on the web, and the extension’s address answer (#2394)', async () => {
  const module = hostClaudeWeb()
  assert.deepEqual(module.plugin, { scope: 'computer' })
  const store: DistributionEntry = { module: { name: 'test-store', hooks: { 'store.backend': memoryStore() } } }
  const project: ProjectRef = { id: 'shop', name: 'shop', dir: '/nowhere', remote: 'github.com/o/r' }
  const off = createHooks([store, { module }])
  assert.deepEqual(await off.hosts(project), [])
  assert.deepEqual(await off.routes(), [])
  const on = createHooks([store, { module, on: true }])
  assert.deepEqual((await on.hosts(project)).map(host => [host.id, host.label]), [[WEB_HOST, 'Claude Code on the web']])
  assert.deepEqual((await on.routes()).map(route => route.path), ['/_bridge'])
})

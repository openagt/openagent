import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createHooks, type DistributionEntry, type ProjectRef } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import { ACTIONS_HOST, hostGithubActions } from './module.js'

test('a plugin kept per project, off until a person switches it on: only then does "Run on" offer GitHub Actions there (#2394)', async () => {
  const module = hostGithubActions()
  assert.deepEqual(module.plugin, { scope: 'project' })
  const store: DistributionEntry = { module: { name: 'test-store', hooks: { 'store.backend': memoryStore() } } }
  const project: ProjectRef = { id: 'shop', name: 'shop', dir: '/nowhere', remote: 'github.com/o/r' }
  assert.deepEqual(await createHooks([store, { module }]).hosts(project), [])
  const hosts = await createHooks([store, { module, on: true }]).hosts(project)
  assert.deepEqual(hosts.map(host => [host.id, host.label]), [[ACTIONS_HOST, 'GitHub Actions']])
})

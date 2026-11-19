import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createHooks, type DistributionEntry } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import notificationsBrowser from './module.js'

test("a plugin kept per person, with no step of a run: on where the person's row says, starting as the distribution starts it", async () => {
  assert.deepEqual(notificationsBrowser.plugin, { scope: 'person' })
  assert.deepEqual(notificationsBrowser.hooks, {})
  const store: DistributionEntry = { module: { name: 'test-store', hooks: { 'store.backend': memoryStore() } } }
  const off = createHooks([store, { module: notificationsBrowser }])
  assert.deepEqual((await off.on()).map(module => module.name), ['test-store'])
  const on = createHooks([store, { module: notificationsBrowser, on: true }])
  assert.deepEqual((await on.on()).map(module => module.name), ['test-store', 'notifications-browser'])
  await on.setEnabled('notifications-browser', false)
  assert.deepEqual((await on.on()).map(module => module.name), ['test-store'])
})

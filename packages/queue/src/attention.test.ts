import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ProjectRef } from '@openagt/hooks'
import { fakeApp } from '@openagt/hooks/testing'
import { queueAttention } from './attention.js'

const SHOP: ProjectRef = { id: 'shop-1', name: 'shop', dir: '/work/shop' }
const APP: ProjectRef = { id: 'app-2', name: 'app', dir: '/work/app' }

test("while no project the queue is on in has an entry, this computer's step says to populate it, fixed on the Queue page", async () => {
  const filled = new Set<string>()
  const ask = queueAttention(async project => filled.has(project.id))
  const app = fakeApp({ projects: async () => [SHOP, APP] })
  const [item, ...more] = await ask({}, app)
  assert.deepEqual({ ...item, detail: undefined }, { kind: 'setup', scope: 'computer', id: 'populate', words: 'Populate the queue of AI tasks', detail: undefined, fix: { label: 'Open the Queue', href: '/queue' } })
  assert.deepEqual(more, [])
  filled.add(APP.id)
  assert.deepEqual(await ask({}, app), [], 'one entry anywhere: populated')
})

test('asked about a project, or with the queue on in none, it says nothing', async () => {
  const ask = queueAttention(async () => false)
  assert.deepEqual(await ask({ project: SHOP }, fakeApp({ projects: async () => [SHOP] })), [])
  assert.deepEqual(await ask({}, fakeApp()), [])
})

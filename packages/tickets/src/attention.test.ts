import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ProjectRef } from '@openagt/hooks'
import { fakeApp } from '@openagt/hooks/testing'
import { ticketsAttention } from './attention.js'
import { POPULATE_ACTION, populatedProject } from './module.js'

const SHOP: ProjectRef = { id: 'shop-1', name: 'shop', dir: '/work/shop' }
const APP: ProjectRef = { id: 'app-2', name: 'app', dir: '/work/app' }

test("while no project the tickets are on in has one, this computer's step offers the first of them an update", async () => {
  const filled = new Set<string>()
  const ask = ticketsAttention(async project => filled.has(project.id))
  const app = fakeApp({ projects: async () => [SHOP, APP] })
  const [item, ...more] = await ask({}, app)
  assert.deepEqual({ ...item, detail: undefined }, { kind: 'setup', scope: 'computer', id: item!.id, words: 'Populate the tickets', title: 'shop', detail: undefined, fix: { label: 'Update tickets', action: POPULATE_ACTION } })
  assert.equal(populatedProject(item!.id), SHOP.id, 'the item names the project its fix starts the run in')
  assert.deepEqual(more, [])
  filled.add(APP.id)
  assert.deepEqual(await ask({}, app), [], 'one ticket anywhere: populated')
})

test('asked about a project, or with the tickets on in none, it says nothing', async () => {
  const ask = ticketsAttention(async () => false)
  assert.deepEqual(await ask({ project: SHOP }, fakeApp({ projects: async () => [SHOP] })), [])
  assert.deepEqual(await ask({}, fakeApp()), [])
})

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { computerHealth, readHealth } from './health.js'

test("this computer's health: its memory in use no more than all of it, its disk, and a reading kept a while", async () => {
  const health = await computerHealth(1_000_000)
  assert.ok(health.memory.total > 0)
  assert.ok(health.memory.used >= 0 && health.memory.used <= health.memory.total)
  assert.ok(health.disk === undefined || (health.disk.used <= health.disk.total && health.disk.total > 0))
  // How busy the processors were: a share of their time, never more than all of it.
  assert.ok(health.load === undefined || (Number.isInteger(health.load) && health.load >= 0 && health.load <= 100))
  assert.equal(computerHealth(1_000_000 + 5_000), computerHealth(1_000_000 + 5_000), 'read again within the window: the same reading')
})

test("another computer's health is kept only as well-formed", () => {
  assert.deepEqual(readHealth({ memory: { total: 8, used: 3 }, disk: { total: 100, used: 40 }, load: 12.6 }), { memory: { total: 8, used: 3 }, disk: { total: 100, used: 40 }, load: 13 })
  assert.equal(readHealth(undefined), undefined)
  assert.equal(readHealth({ memory: { total: 8, used: 9 } }), undefined, 'more in use than there is')
  assert.equal(readHealth({ memory: { total: 0, used: 0 } }), undefined)
  assert.deepEqual(readHealth({ memory: { total: 8, used: 3 }, disk: 'full', load: -1 }), { memory: { total: 8, used: 3 } }, 'a malformed part is left out, the rest kept')
})

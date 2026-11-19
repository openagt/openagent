import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHooks, defineModule } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import { alive, eventually, fakeDoor, starts } from './test-door.js'
import devices, { devicesModule } from './module.js'

test('devices is a plugin kept per computer, off until switched on', () => {
  assert.equal(devices.name, 'devices')
  assert.deepEqual(devices.plugin, { scope: 'computer' })
})

test("switched on, the door runs for as long as OpenAgent does, told OpenAgent's address and the computer; switched off, it is gone", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devices-module-'))
  const hooks = createHooks([{ module: defineModule({ name: 'store-filesystem', hooks: { 'store.backend': memoryStore() } }) }, { module: devicesModule({ bin: await fakeDoor(dir), env: {}, log: () => {} }) }])
  const app = new AbortController()
  try {
    await hooks.started({ signal: app.signal, url: 'http://127.0.0.1:4200', computer: 'c0ffee' })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(await starts(dir).catch(() => []).then(started => started.length), 0, 'off: no door')
    await hooks.setEnabled('devices', true)
    const [started] = await eventually(async () => starts(dir))
    assert.deepEqual([started!.url, started!.computer], ['http://127.0.0.1:4200', 'c0ffee'])
    assert.equal(alive(started!.pid), true)
    await hooks.setEnabled('devices', false)
    assert.equal(alive(started!.pid), false)
    await hooks.setEnabled('devices', true)
    const [, again] = await eventually(async () => ((await starts(dir)).length === 2 ? starts(dir) : undefined))
    app.abort()
    await hooks.stopping()
    assert.equal(alive(again!.pid), false, 'it ends with OpenAgent')
  } finally {
    app.abort()
    await hooks.stopping()
    await rm(dir, { recursive: true, force: true })
  }
})

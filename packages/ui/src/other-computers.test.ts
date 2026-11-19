import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHooks, defineModule } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import { onMachines } from './dashboard-rpc/machines.js'
import { saveMachine } from './dashboard-rpc/save-machine.js'
import { DEVICES_PACKAGE, devicesOn, otherComputers, savedMachines } from './other-computers.js'
import { addMachine } from './registry.js'

test("where devices is off, this computer reaches none of its saved machines: none is listed, none is added, and they are all there again once it is on", async () => {
  const home = await mkdtemp(join(tmpdir(), 'oa-other-computers-'))
  const env = { ...process.env, XDG_CONFIG_HOME: home }
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = home
  const on = otherComputers.on
  try {
    await addMachine({ url: 'http://10.0.0.7:4200', key: 'd1.key', door: 'http://10.0.0.7:4200/_devices/enter', label: 'Studio' }, env)
    otherComputers.on = async () => false
    assert.deepEqual(await savedMachines(env), [])
    assert.deepEqual(await onMachines(), [])
    assert.deepEqual(await saveMachine('http://10.0.0.8:4200/_devices/enter#ab12cd'), { ok: false, error: 'Devices is off on this computer: switch it on in Settings › Plugins first.' })
    otherComputers.on = async () => true
    assert.deepEqual((await onMachines()).map(machine => machine.label), ['Studio'], 'kept while devices was off')
  } finally {
    otherComputers.on = on
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test("devices is on as its row says, and never in a distribution without it", async () => {
  const store = defineModule({ name: 'store-filesystem', hooks: { 'store.backend': memoryStore() } })
  const devices = defineModule({ name: 'devices', plugin: { scope: 'computer' }, hooks: {} })
  const hooks = createHooks([{ module: store }, { package: DEVICES_PACKAGE, module: devices }])
  assert.equal(await devicesOn(hooks), false)
  await hooks.setEnabled('devices', true)
  assert.equal(await devicesOn(hooks), true)
  assert.equal(await devicesOn(createHooks([{ module: store }])), false)
})

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDoorProcess } from './door-process.js'
import { alive, eventually, fakeDoor, starts } from './test-door.js'

test('the door runs `serve`, told where OpenAgent is and which computer this is, and ends when stopped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'door-process-'))
  const log: string[] = []
  const door = startDoorProcess({ bin: await fakeDoor(dir), url: 'http://127.0.0.1:4200', computer: 'c0ffee', env: { XDG_CONFIG_HOME: '/a/home' }, log: line => log.push(line) })
  try {
    const [started] = await eventually(async () => starts(dir))
    assert.deepEqual({ ...started, pid: 0 }, { pid: 0, args: ['serve'], url: 'http://127.0.0.1:4200', computer: 'c0ffee', home: '/a/home' })
    await eventually(async () => (log.includes('door: up') ? true : undefined))
    assert.equal(alive(started!.pid), true)
    await door.stop()
    assert.equal(alive(started!.pid), false)
    assert.equal((await starts(dir)).length, 1, 'ended on purpose, it is not started again')
  } finally {
    await door.stop()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a door that ends by itself is started again, and not once it was stopped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'door-process-'))
  const log: string[] = []
  const door = startDoorProcess({ bin: await fakeDoor(dir, 'process.exit(3)'), url: 'http://127.0.0.1:4200', env: {}, log: line => log.push(line), restartMs: 30 })
  try {
    await eventually(async () => ((await starts(dir)).length >= 3 ? true : undefined))
    assert.ok(log.includes('devices: the door ended (exit 3); it is started again shortly'))
    await door.stop()
    const count = (await starts(dir)).length
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal((await starts(dir)).length, count)
  } finally {
    await door.stop()
    await rm(dir, { recursive: true, force: true })
  }
})
